// 気分・元気度の分析サービス。
//
// このファイルには「インターフェース（約束ごと）」と「モック実装」が入っています。
// AWSを使う実装は awsAnalysisService.ts にあり、どちらを使うかは index.ts が決めます。
//
// mock … intentのmoodからスコアを増減するだけ（外部通信ゼロ）
// aws  … Lambda経由で Rekognition（笑顔）と Comprehend（会話の感情）を呼ぶ
//
// ★「元気度」は観察の目安であって、病気の診断ではありません（CLAUDE.md §2.5）。★

import type { AlertLevel, InterviewAnswer, InterviewResult, InterviewSlot, Mood } from '../types'

// 画面に表示する気分・元気度の状態。
export interface MoodState {
  score: number // 0〜100（50が普通）
  emoji: string // 😊 / 😐 / 😟
  mood: Mood

  // ▼ ここから下はクラウド連携で増えた項目。すべて任意（?付き）なので、
  //    モックや既存のコードは今までどおり動きます。
  smileScore?: number | null // 笑顔スコア 0〜100（Rekognitionの「HAPPY」の確信度）
  sentiment?: string | null // POSITIVE / NEGATIVE / NEUTRAL / MIXED
  baseline?: number | null // ご本人の平常値（直近14日の本人平均）
  level?: AlertLevel
  message?: string // 画面に出す一言。必ず「観察」の言い回しにすること
  pending?: boolean // 分析中（画面でくるくるさせる用）
  source?: 'mock' | 'aws'
}

// 分析にかける材料（会話1ターン分、またはカメラ1枚）。
export interface AnalysisInput {
  text?: string // 聞き取ったテキスト（Comprehend用）
  intentMood?: Mood // matching.ts のローカル判定（モック用・AWSでも参考値として送る）
  imageBase64?: string // カメラの静止画（data URLの先頭を除いた純粋なbase64）
}

// 家族ダッシュボードに出す1日分のまとめ。
export interface HistoryDay {
  date: string // YYYY-MM-DD
  vitality: number | null // その日の元気度
  smileScore: number | null
  sentiment: string | null
  level: AlertLevel
}

// 家族ダッシュボードに出すデータ一式。
export interface HistorySummary {
  userId: string
  days: HistoryDay[] // 新しい順
  baseline: number | null // ご本人の平常値
  baselineSampleCount: number // 平常値の計算に使った日数
  alerts: { timestamp: string; level: AlertLevel; message: string }[]
  lastConversationAt: string | null
}

// 問診1回分の分析にかける材料。
// ★ここがクラウドを叩く唯一のタイミング（1日2回だけ）。
export interface InterviewInput {
  slot: InterviewSlot // morning / evening
  answers: InterviewAnswer[] // 全問の質問と回答
  imageBase64?: string // 笑顔の静止画（撮れなかったときは undefined）
}

export interface AnalysisService {
  // 初期状態（会話開始前の「普通」）。
  initial(): MoodState

  // 直近のintentの mood を受け取り、新しい気分状態を返す。
  // ※mockのときだけ使う同期版。クラウド連携後も互換のために残してあります。
  update(current: MoodState, intentMood: Mood): MoodState

  // 会話テキストやカメラ画像を分析して、新しい元気度を返す。
  // ★失敗しても reject しないこと。必ず MoodState を返す（会話を止めないため）。
  analyze(current: MoodState, input: AnalysisInput): Promise<MoodState>

  // 問診1回分をまとめて分析する。★これが今回の中核。
  // 全問の回答と笑顔を渡し、クラウドが総合的に判断した結果を受け取る。
  // ★失敗しても reject しないこと。必ず InterviewResult を返す。
  analyzeInterview(input: InterviewInput): Promise<InterviewResult>

  // 家族ダッシュボード用の履歴。
  history(days: number): Promise<HistorySummary>
}

// スコアから絵文字を決める。
function emojiFromScore(score: number): string {
  if (score >= 60) return '😊'
  if (score <= 40) return '😟'
  return '😐'
}

// スコアを0〜100に収める。
function clamp(score: number): number {
  return Math.max(0, Math.min(100, score))
}

// mood ごとのスコア増減幅。
const DELTA: Record<Mood, number> = {
  positive: 15,
  negative: -15,
  neutral: 0,
}

// スコアからレベルを決める（モック用の簡易版）。
function levelFromScore(score: number): AlertLevel {
  if (score >= 70) return 'GOOD'
  if (score <= 35) return 'WARNING'
  return 'LOG'
}

export function createMockAnalysisService(): AnalysisService {
  return {
    initial() {
      return { score: 50, emoji: emojiFromScore(50), mood: 'neutral', source: 'mock' }
    },

    update(current, intentMood) {
      const score = clamp(current.score + DELTA[intentMood])
      return { ...current, score, emoji: emojiFromScore(score), mood: intentMood, source: 'mock' }
    },

    // モックの分析。外部通信はせず、その場で計算して返す。
    // 「1〜2秒かけて分析している」感じを出すため、少しだけ待ちます。
    // ★これがあるおかげで、AWSが未完成でもカメラ機能や画面の作り込みを先に進められます。
    async analyze(current, input) {
      await new Promise((resolve) => setTimeout(resolve, 400))

      let next: MoodState = { ...current, source: 'mock', pending: false }

      // カメラ画像が来たとき: 本物のRekognitionの代わりに、それっぽい笑顔スコアを作る。
      if (input.imageBase64) {
        const smileScore = 60 + Math.floor(Math.random() * 30) // 60〜89
        const score = clamp(Math.round(0.6 * smileScore + 0.4 * current.score))
        next = {
          ...next,
          smileScore,
          score,
          emoji: emojiFromScore(score),
          mood: score >= 60 ? 'positive' : score <= 40 ? 'negative' : 'neutral',
          message: 'すてきな笑顔でした（モック）',
        }
      }

      // 会話テキストが来たとき: ローカル判定の mood をそのまま使う。
      if (input.text && input.intentMood) {
        const score = clamp(next.score + DELTA[input.intentMood])
        next = {
          ...next,
          score,
          emoji: emojiFromScore(score),
          mood: input.intentMood,
          sentiment:
            input.intentMood === 'positive'
              ? 'POSITIVE'
              : input.intentMood === 'negative'
                ? 'NEGATIVE'
                : 'NEUTRAL',
        }
      }

      next.level = levelFromScore(next.score)
      return next
    },

    // 問診の分析（モック）。外部通信はせず、回答の内容から簡単に点数を出す。
    // ★これがあるおかげで、AWSが未完成でも問診フローを最後まで作り込めます。
    async analyzeInterview(input) {
      // 「分析している」感じを出すため少し待つ（本番は1〜3秒かかる）。
      await new Promise((resolve) => setTimeout(resolve, 1200))

      // 回答の中に不調をうかがわせる言葉があるかを数える。
      // ※本番では Bedrock の Claude が文脈ごと読んで判断します。
      //   ここはあくまで画面を作るための仮実装です。
      const NEGATIVE_WORDS = ['眠れ', '痛', 'だるい', 'しんど', '食べてない', '疲れ', '調子が悪']
      const POSITIVE_WORDS = ['よく寝', 'ぐっすり', '食べた', '元気', '大丈夫', '調子がいい']

      let score = 55
      for (const a of input.answers) {
        if (NEGATIVE_WORDS.some((w) => a.answer.includes(w))) score -= 12
        if (POSITIVE_WORDS.some((w) => a.answer.includes(w))) score += 10
      }

      // 笑顔が撮れていれば、それっぽいスコアを足して合成する。
      const smileScore = input.imageBase64 ? 60 + Math.floor(Math.random() * 30) : null
      const vitality = clamp(
        smileScore !== null ? Math.round(0.6 * smileScore + 0.4 * score) : score,
      )

      // 仮の平常値（本番は直近14日のご本人の平均）。
      const baseline = 58
      const level: AlertLevel =
        vitality <= baseline - 15 ? 'WARNING' : vitality >= baseline + 10 ? 'GOOD' : 'LOG'

      // ★画面に出す文章は必ず「観察」の言い回しにすること（CLAUDE.md §2.5）。
      //   病名や「診断」という語は使わない。
      const message =
        level === 'WARNING'
          ? `いつもより元気度が低めです（いつもは ${baseline} くらい）`
          : level === 'GOOD'
            ? '今日はお元気そうです'
            : 'いつもどおりの様子です'

      return {
        vitality,
        emoji: emojiFromScore(vitality),
        level,
        smileScore,
        baseline,
        message,
        // モックでは実際のメールは送らない（送ったつもりにもしない）。
        notified: false,
        source: 'mock',
      }
    },

    // モックの履歴。ダッシュボードの見た目を先に作れるよう、それっぽい数字を返す。
    async history(days) {
      await new Promise((resolve) => setTimeout(resolve, 300))

      const list: HistoryDay[] = []
      for (let i = 0; i < days; i++) {
        const d = new Date(Date.now() - i * 86400000)
        // 直近2日だけ低めにして「最近すこし元気がない」という物語が見えるようにする。
        const low = i <= 1
        const vitality = low ? 42 + Math.floor(Math.random() * 8) : 55 + Math.floor(Math.random() * 12)
        list.push({
          date: d.toISOString().slice(0, 10),
          vitality,
          smileScore: vitality + Math.floor(Math.random() * 6) - 3,
          sentiment: low ? 'NEGATIVE' : 'POSITIVE',
          level: levelFromScore(vitality),
        })
      }

      // 平常値は「今日を除いた」過去の平均。
      const past = list.slice(1).map((d) => d.vitality ?? 0)
      const baseline =
        past.length > 0 ? Math.round(past.reduce((a, b) => a + b, 0) / past.length) : null

      return {
        userId: 'elder-001',
        days: list,
        baseline,
        baselineSampleCount: past.length,
        alerts: [
          {
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            level: 'WARNING',
            message: 'いつもより元気度が低めです（モック）',
          },
        ],
        lastConversationAt: new Date(Date.now() - 1800000).toISOString(),
      }
    },
  }
}
