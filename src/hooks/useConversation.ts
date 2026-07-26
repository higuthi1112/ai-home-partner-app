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
import { analysisService, notificationService, config } from '../services'
import type { MoodState } from '../services/analysisService'
import { useSpeechSynthesis } from './useSpeechSynthesis'
import { useSpeechRecognition } from './useSpeechRecognition'
import { useInterview, type UseInterview } from './useInterview'

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
        // どれにも当たらない雑談。
        // ここが将来 chatService（Gemini / Bedrock）に差し替わる場所。
        runAnalysis(text, 'neutral', pickRandom(data.fallback))
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
    const line = isFirst && script ? `${script.greeting} ${q.text}` : q.text

    speakThen(line, () => {
      if (q.type === 'smile') {
        // 笑顔の質問。撮影は Day2 で useCamera を入れる。
        // 今は「撮れなかった」扱いで先に進み、フロー全体を確認できるようにしておく。
        const delay = data.smileCheck?.captureDelayMs ?? 800
        window.setTimeout(() => interview.answerSmile(null), delay)
      } else {
        startListeningRef.current()
      }
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
  const onSpeakButton = useCallback(() => {
    if (avatarState === 'idle') startListening()
  }, [avatarState, startListening])

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
  const startInterview = useCallback(
    (slot: InterviewSlot) => {
      recognition.stop()
      spokenQuestionRef.current = null
      interview.start(slot)
    },
    [recognition, interview],
  )

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
    clearEmergency,
    onSpeakButton,
    submitText,
    startInterview,
  }
}
