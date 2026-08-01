// 会話全体を取り仕切るフック（オーケストレーター）。
//
// このフックが担当するのは「しゃべる／聞き取る」の入出力と、
// 今どちらのモードなのかの切り替えです。
//
//   【雑談モード】…… 日常のおしゃべり。端末内で完結し、クラウドへ送らない。
//   【問診モード】…… 朝晩2回。数問たずねて最後に笑顔を撮り、
//                     全部そろってから1回だけクラウドへ送って判断してもらう。
//
// 問診の「今どの質問か」という進行そのものは useInterview が持っています。
// ここではその質問を読み上げて、返ってきた答えを渡すだけです。
//
// ★2026-07-26 の設計変更★
//   以前は発話するたびに「気分が悪い」等のキーワードで即座に家族へ通知していたが、
//   一言で通報されるのは見守りアプリとして不適切だったため、
//   問診の最後にまとめて判断する方式に変更した。
//   ただし SOS（「助けて」等）だけは例外で、問診中でも即座に中断して通知する。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AvatarState, ConversationData, InterviewSlot, Mood } from '../types'
import { matchInput, pickAcknowledgement, pickRandom, softenChatReply } from '../matching'
import { analysisService, notificationService, chatService, config } from '../services'
import type { MoodState } from '../services/analysisService'
import { useSpeechSynthesis } from './useSpeechSynthesis'
import { useSpeechRecognition } from './useSpeechRecognition'
import { useInterview, type UseInterview } from './useInterview'
import { useCamera, type UseCamera } from './useCamera'
import { currentSlot, isDoneToday, loadWatchTimes, markDoneToday } from '../services/watchSchedule'
import { prefetchSpeech } from '../services/speechService'

// アバターが話し終わってから、聞き取りを始めるまでの待ち時間（ミリ秒）。
//
// ★0にしてはいけない★
//   speechSynthesis の onend は「読み終わった」時点で発火するが、
//   スピーカーから出た音の残響はまだ空気中に残っている。
//   待たずに聞き始めると、その残響を「ご本人の声」として拾ってしまい、
//   何も言っていないのに問診が進む（2026-07-29 に実機で発生）。
//   長くすると会話のテンポが悪くなるので、短めから始めて実機で詰めること。
const LISTEN_DELAY_MS = 400

// ───────── AIの「追いかけ質問」で使う質問ID ─────────
// conversation.json の interview.questions に付けてある id と対応する。
//
// 「この質問の回答をもとに作り」→「この質問と差し替える」という関係。
// 朝は sleep（昨夜はよく眠れましたか？）、夜は day（今日はどんな一日でしたか？）が
// 1問目なので、両方を先読みのきっかけとして見る。
const FIRST_QUESTION_FOR_FOLLOWUP = 'sleep'
const FIRST_QUESTION_FOR_FOLLOWUP_EVENING = 'day'

// 差し替える対象（3問目「体の調子で、気になるところはありますか？」）。
const FOLLOWUP_TARGET_ID = 'body'

// 問診の結果パネルを自動で閉じるまでの時間（ミリ秒）。
// 締めのことばの読み上げが3〜4秒あるので、そのあと数秒読める長さにしている。
// 短くしすぎると読み終わる前に消え、長すぎると次の会話を始めにくい。
const RESULT_AUTO_CLOSE_MS = 10000

// 画面に出す「通知オフ」バッジなどの状態。
export interface StatusBadges {
  notificationsSuppressed: boolean // 「本日 通知オフ」バッジ
  familyToast: string | null // 家族へ通知したことを知らせるバッジ
  emergency: string | null // 緊急バナー（閉じるまで表示）
}

export interface UseConversation {
  avatarState: AvatarState
  supported: boolean
  avatarCaption: string
  userCaption: string
  mood: MoodState
  badges: StatusBadges
  interview: UseInterview
  camera: UseCamera
  clearEmergency: () => void
  onSpeakButton: () => void
  submitText: (text: string) => void
  /** 設定画面の「いま問診を始める」ボタンから呼ぶ。 */
  startInterview: (slot: InterviewSlot) => void
}

export function useConversation(data: ConversationData): UseConversation {
  const synth = useSpeechSynthesis()
  const recognition = useSpeechRecognition()
  const interview = useInterview(data)
  const camera = useCamera()

  // このデモが動く条件は「音声合成と音声認識の両方が使えること」。
  const supported = synth.isSupported && recognition.isSupported

  const [avatarState, setAvatarState] = useState<AvatarState>('idle')
  const [avatarCaption, setAvatarCaption] = useState('')
  const [userCaption, setUserCaption] = useState('')
  const [mood, setMood] = useState<MoodState>(() => analysisService.initial())
  const [badges, setBadges] = useState<StatusBadges>({
    notificationsSuppressed: false,
    familyToast: null,
    emergency: null,
  })

  // 「今の気分」を ref にも写しておく。
  // recognition.start({ onResult }) に渡すコールバックは「傾聴を始めた瞬間の」
  // 関数を掴んだままになるため、state から読むと古い値を見てしまうことがある。
  const moodRef = useRef<MoodState>(mood)

  // 画面(state)と ref を必ずセットで更新する。以後 setMood は直接呼ばない。
  const applyMood = useCallback((next: MoodState) => {
    moodRef.current = next
    setMood(next)
  }, [])

  // 分析の「何回目か」を数える番号。古い結果が後から届いてスコアが
  // 巻き戻るのを防ぐ（非同期化で必ず踏むバグ）。
  const analysisSeqRef = useRef(0)

  // 今が問診モードかどうか。聞き取りのコールバックから参照するので ref に持つ。
  const inInterviewRef = useRef(false)
  inInterviewRef.current = interview.state === 'asking'

  // 同じ質問を二度読み上げないための記録。
  const spokenQuestionRef = useRef<string | null>(null)

  // 問診で直前に受け取った回答。次の質問の前に「相槌」を作るために使う。
  // 聞き取りのコールバックから書き込まれるので、state ではなく ref に持つ。
  const lastAnswerRef = useRef<string>('')

  // ★AIが作った「追いかけ質問」を置いておく場所★
  //   1問目に答えた瞬間に裏で作り始め、3問目を読むときにここを見る。
  //   空なら台本の固定文を読む（＝失敗しても問診は止まらない）。
  const followUpRef = useRef<string>('')

  // 直前に「実際に読み上げた」質問文。
  //   3問目はAIの質問に差し替わることがあるため、記録には台本の文ではなく
  //   こちらを残す。そうしないと「聞いていない質問」と回答が対になってしまう。
  const spokenTextRef = useRef<string>('')

  // いま聞き取り結果を受け付けてよいか。
  //
  // ★アバターの声を自分で拾わないための歯止め★
  //   recognition.stop() だけでは足りない。stop() は非同期で、
  //   直前に取り込んだ音の認識結果があとから届くことがあるため。
  //   「聞いている状態のときに届いた結果だけを使う」と決めておけば、
  //   どの経路から来た結果でも確実に弾ける。
  //   ※state ではなく ref。認識のコールバックは傾聴開始時点の閉包を掴むので、
  //     state だと古い値を読んでしまう（moodRef と同じ理由）。
  const acceptInputRef = useRef<boolean>(false)

  // 雑談の流れ（直近のやりとり）。AIに文脈を渡すために覚えておく。
  // 「ユーザー, アバター, ユーザー, アバター…」の順に入れ、直近6件だけ保つ。
  const chatHistoryRef = useRef<string[]>([])

  // 雑談が何往復続いたか。conversation.json の chat.maxTurns に達したら
  // 締めのことばを添えて 0 に戻す（＝次の雑談はまた1ターン目から始まる）。
  // 質問を許すターンを決めるのにも使う。詳しくは types.ts の ChatFlowConfig。
  const chatTurnRef = useRef<number>(0)

  // startListening と speakAndListen が互いを呼び合うため、ref 経由で最新を参照する。
  const startListeningRef = useRef<() => void>(() => {})

  // 傾聴を開始する。
  const startListening = useCallback(() => {
    if (!recognition.isSupported) return
    setAvatarState('listening')
    setUserCaption('')
    // ★ここから先の聞き取り結果だけを受け付ける★（下の acceptInputRef の説明を参照）
    acceptInputRef.current = true
    recognition.start({
      onResult: (text, isFinal) => {
        // ★アバターの声を自分で拾ってしまう事故を防ぐ★
        //   聞き取り中でないときに届いた結果は、すべて捨てる。
        //   閉じ損ねた古いセッションや、スピーカーの残響が「回答」として
        //   扱われると、ご本人が何も言っていないのに問診が進んでしまう。
        if (!acceptInputRef.current) return
        setUserCaption(text)
        if (isFinal) handleUserSpeech(text)
      },
      // マイク不許可などのエラー時は、待機に戻すだけ（案内は画面下に常設）。
      onError: () => setAvatarState('idle'),
    })
    // handleUserSpeech は下で定義。最新版を使うため依存に入れず ref を介する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recognition])

  startListeningRef.current = startListening

  // セリフをしゃべり、しゃべり終わったら指定の処理へ進む。
  //
  // ★アバターが話している間は、絶対に聞き取りを受け付けない★（2026-07-29 修正）
  //   以前はここで聞き取りを止めていなかったため、アバターの声をマイクが拾い、
  //   ご本人が何も言っていないのに問診が進んでしまう不具合があった。
  //   （CLAUDE.md §9 には「speak() 前に stop() する」と書いてあったが、
  //     実装がそうなっていなかった。）
  //   対策は2つ重ねてある。片方だけでは漏れる。
  //     1. recognition.stop() … 動いているセッションを閉じる
  //     2. acceptInputRef=false … 閉じ損ねたセッションから結果が届いても捨てる
  //   なお「話の途中で口をはさむ」機能は元から無い（聞き取りは発話後に始まる）ので、
  //   これで失われる機能はない。
  const speakThen = useCallback(
    (text: string, after: () => void) => {
      acceptInputRef.current = false
      recognition.stop()
      setAvatarState('speaking')
      setAvatarCaption(text)
      synth.speak(text, () => {
        setAvatarState('idle')
        // ★すぐに聞き始めない★
        //   speechSynthesis の onend は「読み終わった」時点で発火するが、
        //   スピーカーから出た音の残響はまだ空気中に残っている。
        //   ここで一拍おかないと、その残響を自分の声として拾ってしまう。
        window.setTimeout(after, LISTEN_DELAY_MS)
      })
    },
    [synth, recognition],
  )

  // セリフをしゃべり、しゃべり終わったら自動でまた傾聴に戻る（ターンテイキング）。
  const speakAndListen = useCallback(
    (text: string) => {
      speakThen(text, () => startListeningRef.current())
    },
    [speakThen],
  )

  // ご家族へ緊急のお知らせを送る。★問診中でも即座に実行する。
  const raiseEmergency = useCallback(
    (text: string) => {
      const notified = notificationService.notify('emergency')
      setBadges((prev) => ({ ...prev, emergency: notified.message }))
      notificationService.send('emergency', { text, vitality: moodRef.current.score }).then((res) => {
        if (res.message) setBadges((prev) => ({ ...prev, emergency: res.message }))
      })
    },
    [],
  )

  // 雑談の分析（従来どおり）。返事は先に、分析は裏で。
  const runAnalysis = useCallback(
    (text: string, intentMood: Mood, reply: string) => {
      const seq = ++analysisSeqRef.current
      const before = moodRef.current
      applyMood({ ...before, pending: true })

      const promise = analysisService.analyze(before, { text, intentMood })
      const applyResult = (next: MoodState) => {
        if (seq !== analysisSeqRef.current) return
        applyMood({ ...next, pending: false })
      }

      if (config.analysisSync) {
        promise.then((next) => {
          applyResult(next)
          speakAndListen(reply)
        })
      } else {
        speakAndListen(reply)
        promise.then(applyResult)
      }
    },
    [applyMood, speakAndListen],
  )

  // 聞き取った言葉への対応。問診中か雑談中かで処理が分かれる。
  const handleUserSpeech = useCallback(
    (text: string) => {
      // 1回分の発言を受け取ったので、次に startListening するまでは何も受け付けない。
      // Chrome は stop() のあとにも、取り込み済みの音の認識結果を追加で届けることがある。
      // それを2回目の発言として扱うと、問診が2問ぶん飛ぶ。
      acceptInputRef.current = false
      recognition.stop()

      const result = matchInput(text, data)

      // ───────────── 問診モード ─────────────
      if (inInterviewRef.current) {
        // ★SOSだけは例外★ 問診を中断して即座に家族へ知らせる。
        // 倒れている人に「では次の質問です」と続けるのは、見守りアプリとして致命的。
        if (result.type === 'control' && result.entry.action === 'emergency') {
          interview.cancel()
          raiseEmergency(text)
          speakAndListen(result.entry.response)
          return
        }
        // それ以外はすべて「回答」として貯める。ここでは通知も分析もしない。
        // 次の質問の前に相槌を作れるよう、回答の中身だけ覚えておく。
        lastAnswerRef.current = text

        // ★ここで「追いかけ質問」を先読みする（今回の設計の肝）★
        //   1問目に答えたこの瞬間に、裏でAIに質問を作らせ始める。**待たない。**
        //   実際に使うのは3問目なので、その間に2問目の読み上げと聞き取り
        //   （10〜15秒）が挟まる。AIの往復は2〜3秒なので確実に間に合う。
        //   ＝ 問診がもたつかない。これが相槌をAIにやらせてやめた理由への答え。
        //   間に合わなかった場合も、台本の固定文が読まれるだけで問診は止まらない。
        const askedNow = interview.question
        const isFirstQuestion =
          askedNow?.id === FIRST_QUESTION_FOR_FOLLOWUP ||
          askedNow?.id === FIRST_QUESTION_FOR_FOLLOWUP_EVENING
        if (config.followUpEnabled && askedNow && isFirstQuestion) {
          chatService
            .followUpQuestion(askedNow.text, text)
            .then((q) => {
              // null なら差し替えない（台本どおりに進む）。
              if (q) followUpRef.current = q
            })
            .catch(() => {
              // ここには来ない想定（chatService は例外を投げない約束）だが、
              // 万一のときも問診が止まらないよう受け止めておく。
            })
        }

        // 実際に読み上げた文を渡す（3問目はAIの質問に差し替わっていることがある）。
        interview.answerText(text, spokenTextRef.current)
        return
      }

      // ───────────── 雑談モード ─────────────
      if (result.type === 'control') {
        // 笑顔チェックは問診の中でやるので、単体では案内だけして終わる。
        if (result.entry.action === 'smileCheck') {
          speakAndListen(result.entry.response)
          return
        }

        if (result.entry.action === 'emergency') {
          raiseEmergency(text)
          speakAndListen(result.entry.response)
          return
        }

        // 「今日は病院」など。まず即座に画面へ出し、送信結果で文言を差し替える。
        const notified = notificationService.notify(result.entry.action)
        setBadges((prev) =>
          result.entry.action === 'suppressNotifications'
            ? { ...prev, notificationsSuppressed: true }
            : { ...prev, familyToast: notified.message },
        )
        notificationService
          .send(result.entry.action, { text, vitality: moodRef.current.score })
          .then((res) => {
            if (!res.message) return
            setBadges((prev) =>
              result.entry.action === 'suppressNotifications'
                ? { ...prev, notificationsSuppressed: true }
                : { ...prev, familyToast: res.message },
            )
          })
        speakAndListen(result.entry.response)
      } else if (result.type === 'intent') {
        runAnalysis(text, result.entry.mood, pickRandom(result.entry.responses))
      } else {
        // ── どれにも当たらない雑談 ──
        // AI（Gemini / Bedrock）に返事を作ってもらう。
        // 作れなければ conversation.json の fallback のことばで返す。
        // ★ここでも「AIが失敗しても会話は続く」ことを守る★
        //
        // ★履歴の扱いに注意（2026-07-28 修正）★
        //   渡すのは「今の発言より前」のやりとりだけ。今の発言（text）は
        //   Lambda側が messages の最後に自分で付け足すため、ここで履歴に入れて
        //   から渡すと、同じ発言が2回続けて送られてしまう。
        //   AIに渡す会話は「ユーザー→AI→ユーザー→AI…」と交互である必要があり、
        //   user が2回続くとAIに拒否されて返事が返らなくなる。
        const historyBefore = chatHistoryRef.current

        // ★雑談の進み具合を数える（2026-07-29 追加）★
        //   AIは毎回「〜ですか？」と質問を返してくる（CHAT_SYSTEM がそう指示している）。
        //   高齢のご本人には尋問されている感じになって疲れるので、
        //   「何ターン目に質問を許すか」をアプリ側で決め打ちにする。
        //   AIに「3回に1回だけ質問して」と頼んでも守られないため、後から消す方式にした。
        const flow = data.chat
        const turn = chatTurnRef.current + 1
        chatTurnRef.current = turn

        // このターンは質問を許すか（既定では1ターン目だけ）。
        const allowQuestion = !flow || turn === flow.askQuestionOnTurn
        // このターンで雑談を一区切りにするか。
        const isLastTurn = !!flow && turn >= flow.maxTurns

        chatService
          .reply(text, historyBefore)
          .then((aiReply) => {
            // ★発言と返事は必ず「対」で履歴に足す★
            //   AIが答えられなかった回に発言だけを足すと、以降ずっと
            //   交互の並びが崩れたままになり、雑談が復活しなくなる。
            //   ※履歴にはAIの元の返事（質問つき）を入れる。加工後を入れると、
            //     AIから見て自分の発言が書き換わっていることになり文脈が濁る。
            if (aiReply) {
              chatHistoryRef.current = [...historyBefore, text, aiReply].slice(-6)
            }

            // AIが答えられなければ conversation.json の fallback で返す。
            // fallback は元から質問を含まないので、加工しない。
            if (!aiReply) {
              runAnalysis(text, 'neutral', pickRandom(data.fallback))
              return
            }

            // 質問を許さないターンなら、末尾の疑問文を落として共感だけ残す。
            // 削った残りが短すぎるときは、相槌の語彙で温かく言い直す（softenChatReply）。
            let reply = allowQuestion ? aiReply : softenChatReply(aiReply, text, data)

            // 最後のターンなら締めのことばを添えて、次の雑談を最初から始められるようにする。
            if (isLastTurn && flow.closing.length > 0) {
              reply = `${reply} ${pickRandom(flow.closing)}`
              chatTurnRef.current = 0
              chatHistoryRef.current = []
            }

            runAnalysis(text, 'neutral', reply)
          })
          .catch(() => {
            runAnalysis(text, 'neutral', pickRandom(data.fallback))
          })
      }
    },
    [data, recognition, speakAndListen, runAnalysis, interview, raiseEmergency],
  )

  // ───────── 問診の質問を読み上げる ─────────
  // useInterview が「次はこの質問」と決めたら、ここが声に出して聞き取りへ回す。
  useEffect(() => {
    if (interview.state !== 'asking') return
    const q = interview.question
    if (!q) return

    // 同じ質問を二度読み上げないようにする（再描画のたびに喋ると壊れる）。
    if (spokenQuestionRef.current === q.id) return
    spokenQuestionRef.current = q.id

    // 1問目だけ、前に挨拶をつけて自然に入る。
    const script = interview.slot ? data.interview?.[interview.slot] : null
    const isFirst = interview.questionNumber === 1

    // ★AIの「追いかけ質問」があれば、台本の文と差し替える★
    //   1問目に答えた時点で裏で作り始めているので、ここに届いていることが多い。
    //   間に合わなかった・作れなかった・内容が不正だった場合は空のままなので、
    //   台本の固定文がそのまま読まれる（＝問診は絶対に止まらない）。
    const questionText =
      q.id === FOLLOWUP_TARGET_ID && followUpRef.current ? followUpRef.current : q.text

    // 実際に読み上げた文を覚えておく（回答を記録するときに使う）。
    spokenTextRef.current = questionText

    // 質問を読み上げて、そのあと聞き取り（または撮影）へ進む。
    const askQuestion = (line: string) => {
      speakThen(line, () => {
        if (q.type === 'smile') {
          // 笑顔の質問。「話す」ボタンを押した時点で起動済みのはずだが、
          // 念のためここでも呼んでおく（start() は起動済みなら何もしない）。
          const delay = data.smileCheck?.captureDelayMs ?? 800
          camera.start().then(() => {
            window.setTimeout(() => interview.answerSmile(camera.capture()), delay)
          })
        } else {
          startListeningRef.current()
        }
      })
    }

    // ── 1問目: 挨拶をつけて、そのまま質問する（相槌の相手がまだいない） ──
    if (isFirst) {
      askQuestion(script ? `${script.greeting} ${q.text}` : q.text)
      return
    }

    // ── 2問目以降: 直前の回答に相槌を打ってから質問する ──
    //
    // ★相槌はAIに作らせず、端末内で選ぶ（2026-07-28 変更）★
    //   以前はここでLambda経由でAIに相槌を作らせ、2.5秒待っていた。
    //   やめた理由は3つ。
    //     1. 待ち時間。1〜1.5秒かかり、会場のWi-Fiではさらに延びる。
    //        相槌は質問と質問の間に入るので、ここで待つと問診全体がもたつく。
    //     2. AIが質問を返してしまう事故。相槌の直後には必ず次の質問が続くため、
    //        相槌が「〜ですか？」で終わると質問が2つ並んで不自然になる。
    //        「質問するな」と指示しても、守られる保証がない。
    //     3. 禁止語（CLAUDE.md §2.5）が混ざる可能性を、ゼロにできない。
    //   相槌は一言受け止めるだけのものなので、確実さを取った。
    //   語彙は conversation.json の acknowledgements にある（非エンジニアが編集可）。
    //   ※AIによる相槌は提出後の改良項目。Lambda側の受け口は残してある。
    //
    // 同期処理になったので、待ちもタイムアウトも無く、必ず1回で読み上げられる。
    const previousAnswer = lastAnswerRef.current
    lastAnswerRef.current = '' // 同じ回答に二度相槌を打たないよう、使ったら消す

    // ?ack=off / VITE_ACK=off のときは相槌を挟まない（当日もたつくときの退避）。
    const ack = config.acknowledgeEnabled ? pickAcknowledgement(previousAnswer, data) : null

    // questionText は上で決めた「実際に読み上げる文」（AIの追いかけ質問または台本の文）。
    askQuestion(ack ? `${ack} ${questionText}` : questionText)
    // 質問が変わったときだけ動かす。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview.state, interview.question?.id])

  // ───────── 問診が終わったら締めのことばを言う ─────────
  useEffect(() => {
    if (interview.state !== 'done' || !interview.result) return
    spokenQuestionRef.current = null

    // 結果の元気度を画面上部のバッジにも反映する。
    if (interview.result.vitality !== null) {
      applyMood({
        ...moodRef.current,
        score: interview.result.vitality,
        emoji: interview.result.emoji,
        level: interview.result.level,
        baseline: interview.result.baseline,
        smileScore: interview.result.smileScore,
        pending: false,
      })
    }

    const script = interview.slot ? data.interview?.[interview.slot] : null
    if (script) speakThen(script.closing, () => {})

    // ★一定時間たったら自動で閉じて、いつもの画面に戻す★
    //   高齢者に「閉じる」ボタンを探させないため。押さないと戻れない作りだと、
    //   パネルが出たまま放置され、次に話しかけようとしたときに戸惑わせてしまう。
    //   自分で閉じたい人のためにボタンは残してある（押せば即座に閉じる）。
    const timer = window.setTimeout(() => interview.close(), RESULT_AUTO_CLOSE_MS)
    return () => window.clearTimeout(timer)
    // 結果が出たときだけ動かす。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview.state, interview.result])

  // 起動時: 音声の準備ができたら openings をランダムに1つしゃべり、会話を始める。
  useEffect(() => {
    if (!supported) return

    // 第一声だけは先読みが間に合わない（開いた直後に話すため）。
    // せめて挨拶の候補を先に頼んでおき、2回目以降は待ちが無いようにする。
    prefetchSpeech(data.openings)

    const greet = () => speakAndListen(pickRandom(data.openings))

    // 音声リストは非同期で読み込まれることがあるため、未ロードなら待つ。
    if (window.speechSynthesis.getVoices().length > 0) {
      greet()
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', greet, { once: true })
    }
    // 初回マウント時に一度だけ実行すればよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported])

  // 「話す」ボタン: 待機中のときだけ手動で傾聴を開始する。
  // ★ここが確実なユーザー操作なので、カメラもここで起動しておく★
  //   問診の最後（笑顔チェック）まで待つと権限確認の分だけ間が空いてしまう。
  const onSpeakButton = useCallback(() => {
    if (avatarState === 'idle') {
      startListening()
      void camera.start()
    }
  }, [avatarState, startListening, camera])

  // 手入力の送信（マイクが使えないときの保険）。音声と同じ経路を通す。
  const submitText = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setUserCaption(trimmed)
      handleUserSpeech(trimmed)
    },
    [handleUserSpeech],
  )

  // 問診を始める（設定画面のボタン・時刻の自動起動から呼ばれる）。
  // ボタンを押す操作自体がユーザー操作なので、ここでもカメラを起動しておく。
  const startInterview = useCallback(
    (slot: InterviewSlot) => {
      acceptInputRef.current = false
      recognition.stop()
      spokenQuestionRef.current = null
      // 前回の問診の回答が残っていると、1問目から的外れな相槌が出てしまう。
      lastAnswerRef.current = ''
      // ★前回の追いかけ質問を必ず捨てる★
      //   残っていると、今日の回答と関係のない質問（昨日の腰の話など）を
      //   3問目でいきなり尋ねてしまう。
      followUpRef.current = ''
      spokenTextRef.current = ''

      // ★これから読む台本の音声を、まとめて先に取りに行く★
      //   クラウドの音声は取得に1〜2秒かかる。質問のたびに待つと、
      //   そのあいだアバターが黙ってしまい問診がもたつく。
      //   ここで先に頼んでおけば、実際に読むころには届いている。
      //   待たないので、間に合わなくても問診の進行には影響しない。
      const script = data.interview?.[slot]
      if (script) {
        prefetchSpeech([
          `${script.greeting} ${script.questions[0]?.text ?? ''}`,
          ...script.questions.slice(1).map((q) => q.text),
          script.closing,
        ])
      }
      // 雑談の途中で問診が始まることがある。数えを持ち越すと、問診のあとの雑談が
      // いきなり「3ターン目（＝すぐ締める）」から始まってしまうのでここで戻す。
      chatTurnRef.current = 0
      chatHistoryRef.current = []
      interview.start(slot)
      void camera.start()
    },
    [recognition, interview, camera],
  )

  // ───────── 時刻による問診の自動起動 ─────────
  // 設定画面（SettingsMenu）で決めた起床・就寝の時刻の前後30分に入ったら、
  // 手が空いているタイミングで自動的に問診を始める。
  // ★会話中・問診中には割り込まない★（次の巡回で再挑戦するだけなので安全）。
  // 「いま始める」ボタン（デモ当日の生命線）は startInterview を直接呼ぶ別ルートのまま。
  useEffect(() => {
    if (!supported) return

    const tryAutoStart = () => {
      // ★「idle」だけを条件にしない★
      // ターンテイキング中は speaking → listening を直接行き来し、idle にはほぼ戻らない
      // （常時待機アバターの設計上、これが正常）。「聞き取り中」は次の質問に切り替えても
      // 支障がないので許可し、発話の途中（speaking）だけは避ける。
      if (avatarState === 'speaking' || interview.state !== 'idle') return

      const slot = currentSlot(loadWatchTimes())
      if (!slot || isDoneToday(slot)) return

      // 開始前に「済み」を記録しておく。次の巡回（60秒後）で二重に始まらないようにするため。
      markDoneToday(slot)
      startInterview(slot)
    }

    tryAutoStart() // 画面を開いた瞬間が時間帯に入っていることもあるので、即座にも確認する
    const timer = window.setInterval(tryAutoStart, 60000)
    return () => window.clearInterval(timer)
  }, [supported, avatarState, interview.state, startInterview])

  const clearEmergency = useCallback(() => {
    setBadges((prev) => ({ ...prev, emergency: null }))
  }, [])

  return {
    avatarState,
    supported,
    avatarCaption,
    userCaption,
    mood,
    badges,
    interview,
    camera,
    clearEmergency,
    onSpeakButton,
    submitText,
    startInterview,
  }
}
