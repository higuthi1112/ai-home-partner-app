// 問診（インタビュー）の進行だけを担当するフック。
//
// ★このフックは「今どの質問か」を管理するだけで、
//   しゃべる・聞き取る・カメラで撮る といった処理は一切しません。
//   それらは useConversation 側の仕事です。
//   こう分けておくと、進行のルールだけを目で追えて、
//   マイクやカメラの担当が1箇所（useConversation）にまとまります。
//
// 進行の流れ:
//   idle（待機）
//     → start(slot) が呼ばれる
//   asking（質問中）… 1問ずつ進む。回答はここに貯めるだけで送信しない
//     → 全部の質問が終わる
//   analyzing（分析中）… ここで初めてクラウドへ1回だけ送る
//     → 結果が返る
//   done（結果表示）
//     → close() で idle に戻る

import { useCallback, useRef, useState } from 'react'
import type {
  ConversationData,
  InterviewAnswer,
  InterviewQuestion,
  InterviewResult,
  InterviewSlot,
} from '../types'
import { analysisService } from '../services'

export type InterviewState = 'idle' | 'asking' | 'analyzing' | 'done'

export interface UseInterview {
  state: InterviewState
  slot: InterviewSlot | null
  /** 今たずねている質問（待機中は null） */
  question: InterviewQuestion | null
  /** 何問目か（1始まり。画面の「3問目/5問」表示に使う） */
  questionNumber: number
  totalQuestions: number
  /** 問診が終わったあとの結果（まだ無ければ null） */
  result: InterviewResult | null

  /** 問診を始める。台本が無い時間帯を指定した場合は何も起きない。 */
  start: (slot: InterviewSlot) => void
  /** 声で答えてもらう質問に回答する。聞き取れなければ空文字でよい。 */
  answerText: (text: string) => void
  /** 笑顔の質問に答える。撮れなかったときは null を渡す。 */
  answerSmile: (imageBase64: string | null) => void
  /** 途中でやめる（緊急時など）。 */
  cancel: () => void
  /** 結果パネルを閉じて待機に戻る。 */
  close: () => void
}

export function useInterview(data: ConversationData): UseInterview {
  const [state, setState] = useState<InterviewState>('idle')
  const [slot, setSlot] = useState<InterviewSlot | null>(null)
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<InterviewResult | null>(null)

  // 回答は「貯めるだけ」。画面の再描画には関係しないので ref に持つ。
  // （state にすると回答のたびに再描画が走り、発話の途中で邪魔になる）
  const answersRef = useRef<InterviewAnswer[]>([])
  const imageRef = useRef<string | null>(null)

  // 何回目の問診かを数える番号。
  // 途中でキャンセルして別の問診を始めたとき、前の分析結果が遅れて届いても
  // 無視できるようにするための保険。
  const runSeqRef = useRef(0)

  // ★今の質問リストと「何問目か」は ref でも持っておく★
  //   回答は音声認識のコールバックから渡ってくるが、そのコールバックは
  //   「聞き取りを始めた瞬間の」関数を掴んだままになる。
  //   描画のたびに作り直される値をそのまま使うと、古い質問番号に
  //   答えを記録してしまう恐れがあるため、ref から読む。
  const questionsRef = useRef<InterviewQuestion[]>([])
  const indexRef = useRef(0)
  const slotRef = useRef<InterviewSlot | null>(null)

  // 今の時間帯の台本。conversation.json に interview が無ければ null。
  const script = slot ? (data.interview?.[slot] ?? null) : null
  const questions = script?.questions ?? []
  const question = state === 'asking' ? (questions[index] ?? null) : null

  // 全部の回答がそろったので、まとめて1回だけクラウドへ送る。
  const finish = useCallback(
    (currentSlot: InterviewSlot) => {
      const seq = ++runSeqRef.current
      setState('analyzing')

      analysisService
        .analyzeInterview({
          slot: currentSlot,
          answers: answersRef.current,
          imageBase64: imageRef.current ?? undefined,
        })
        .then((res) => {
          // 途中でキャンセルされて別の問診が始まっていたら、この結果は捨てる。
          if (seq !== runSeqRef.current) return
          setResult(res)
          setState('done')
        })
    },
    [],
  )

  // 回答を1つ記録して次へ進める。最後の質問だったら分析へ移る。
  // ★ここは ref だけを読む★ 古いコールバックから呼ばれても正しく動くようにするため。
  const recordAndAdvance = useCallback(
    (answer: InterviewAnswer) => {
      const currentSlot = slotRef.current
      if (!currentSlot) return

      answersRef.current = [...answersRef.current, answer]

      const nextIndex = indexRef.current + 1
      indexRef.current = nextIndex

      if (nextIndex >= questionsRef.current.length) {
        finish(currentSlot)
      } else {
        setIndex(nextIndex)
      }
    },
    [finish],
  )

  const start = useCallback(
    (nextSlot: InterviewSlot) => {
      const nextScript = data.interview?.[nextSlot]
      if (!nextScript || nextScript.questions.length === 0) {
        console.warn(`[useInterview] ${nextSlot} の問診台本が conversation.json にありません`)
        return
      }
      // 前回の分析結果が遅れて届いても無視されるよう、番号を進めておく。
      runSeqRef.current++
      answersRef.current = []
      imageRef.current = null
      questionsRef.current = nextScript.questions
      indexRef.current = 0
      slotRef.current = nextSlot

      setSlot(nextSlot)
      setIndex(0)
      setResult(null)
      setState('asking')
    },
    [data],
  )

  const answerText = useCallback(
    (text: string) => {
      const q = questionsRef.current[indexRef.current]
      if (!slotRef.current || !q) return
      // 質問文も一緒に記録する。分析するとき文脈がないと判断できないため。
      recordAndAdvance({ questionId: q.id, question: q.text, answer: text.trim() })
    },
    [recordAndAdvance],
  )

  const answerSmile = useCallback(
    (imageBase64: string | null) => {
      const q = questionsRef.current[indexRef.current]
      if (!slotRef.current || !q) return

      imageRef.current = imageBase64
      recordAndAdvance({
        questionId: q.id,
        question: q.text,
        answer: imageBase64 ? '（笑顔を撮影しました）' : '（撮影できませんでした）',
      })
    },
    [recordAndAdvance],
  )

  const cancel = useCallback(() => {
    // 進行中の分析結果が後から届いても無視されるようにする。
    runSeqRef.current++
    answersRef.current = []
    imageRef.current = null
    questionsRef.current = []
    indexRef.current = 0
    slotRef.current = null
    setState('idle')
    setSlot(null)
    setIndex(0)
  }, [])

  const close = useCallback(() => {
    questionsRef.current = []
    indexRef.current = 0
    slotRef.current = null
    setState('idle')
    setSlot(null)
    setIndex(0)
    setResult(null)
  }, [])

  return {
    state,
    slot,
    question,
    questionNumber: index + 1,
    totalQuestions: questions.length,
    result,
    start,
    answerText,
    answerSmile,
    cancel,
    close,
  }
}
