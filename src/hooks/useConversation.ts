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
import { matchInput, pickRandom } from '../matching'
import { analysisService, notificationService, chatService, config } from '../services'
import type { MoodState } from '../services/analysisService'
import { useSpeechSynthesis } from './useSpeechSynthesis'
import { useSpeechRecognition } from './useSpeechRecognition'
import { useInterview, type UseInterview } from './useInterview'
import { useCamera, type UseCamera } from './useCamera'
import { currentSlot, isDoneToday, loadWatchTimes, markDoneToday } from '../services/watchSchedule'

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

  // 雑談の流れ（直近のやりとり）。AIに文脈を渡すために覚えておく。
  // 「ユーザー, アバター, ユーザー, アバター…」の順に入れ、直近6件だけ保つ。
  const chatHistoryRef = useRef<string[]>([])

  // startListening と speakAndListen が互いを呼び合うため、ref 経由で最新を参照する。
  const startListeningRef = useRef<() => void>(() => {})

  // 傾聴を開始する。
  const startListening = useCallback(() => {
    if (!recognition.isSupported) return
    setAvatarState('listening')
    setUserCaption('')
    recognition.start({
      onResult: (text, isFinal) => {
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
  const speakThen = useCallback(
    (text: string, after: () => void) => {
      setAvatarState('speaking')
      setAvatarCaption(text)
      synth.speak(text, () => {
        setAvatarState('idle')
        after()
      })
    },
    [synth],
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
        interview.answerText(text)
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
        chatService
          .reply(text, historyBefore)
          .then((aiReply) => {
            const reply = aiReply ?? pickRandom(data.fallback)
            // ★発言と返事は必ず「対」で履歴に足す★
            //   AIが答えられなかった回に発言だけを足すと、以降ずっと
            //   交互の並びが崩れたままになり、雑談が復活しなくなる。
            if (aiReply) {
              chatHistoryRef.current = [...historyBefore, text, aiReply].slice(-6)
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
    // ★相槌は「あれば嬉しい」程度のものとして扱う★
    //   失敗しても・遅くても、質問だけを読み上げて必ず先へ進む。
    //   進行が相槌の成否に左右されないことが、この設計でいちばん大事な点。
    const previousAnswer = lastAnswerRef.current
    lastAnswerRef.current = '' // 同じ回答に二度相槌を打たないよう、使ったら消す

    if (!previousAnswer) {
      askQuestion(q.text)
      return
    }

    chatService
      .acknowledge(previousAnswer)
      .then((ack) => {
        // 相槌が間に合ったら「相槌 → 質問」、だめなら質問だけ。
        askQuestion(ack ? `${ack} ${q.text}` : q.text)
      })
      .catch(() => {
        // ここには来ない想定（chatService は例外を投げない約束）だが、
        // 万一のときも問診が止まらないよう受け止めておく。
        askQuestion(q.text)
      })
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
    // 結果が出たときだけ動かす。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview.state, interview.result])

  // 起動時: 音声の準備ができたら openings をランダムに1つしゃべり、会話を始める。
  useEffect(() => {
    if (!supported) return

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
      recognition.stop()
      spokenQuestionRef.current = null
      // 前回の問診の回答が残っていると、1問目から的外れな相槌が出てしまう。
      lastAnswerRef.current = ''
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
