// アプリ全体で共有する型定義。
// 会話データ(conversation.json)の形と、画面状態の型をここにまとめておく。

// 気分の種類。mockではローカル判定、awsではComprehendの分析結果が入る。
export type Mood = 'positive' | 'negative' | 'neutral'

// 通知の重大度（仕様書のエスカレーション設計に対応）。
//   EMERGENCY … 本人SOS。即時・通知オフ設定も無視して送る
//   WARNING   … 元気度が平常値より低下。送るが、通知オフ設定は尊重する
//   LOG       … 通常。記録のみ、通知しない
//   GOOD      … 元気そう。記録のみ、通知しない
export type AlertLevel = 'EMERGENCY' | 'WARNING' | 'LOG' | 'GOOD'

// 制御フレーズが起こす「行動」の種類。
//   smileCheck … 「笑ってください」と促してカメラで1枚撮り、表情を分析する
export type ControlAction =
  | 'suppressNotifications'
  | 'notifyFamily'
  | 'emergency'
  | 'smileCheck'

// 通常の会話意図（キーワード → 返答候補）。
export interface Intent {
  id: string
  keywords: string[]
  responses: string[]
  mood: Mood
}

// 本人の制御フレーズ（「今日は病院」「気分が悪い」等）。優先的に判定される。
export interface ControlPhrase {
  id: string
  keywords: string[]
  action: ControlAction
  response: string
}

// 笑顔チェックのセリフと設定。
// ※セリフはコードに埋め込まず、必ずここ（conversation.json）に置くこと。
export interface SmileCheckConfig {
  captureDelayMs: number // 「笑ってください」と言い終わってから撮るまでの待ち時間
  success: string[] // 撮影できたときのセリフ
  failure: string[] // 顔が写らなかったときのセリフ
}

// ===== 問診（インタビュー）の型 =====
// 朝晩2回、アバターが数問たずねて、最後に笑顔を撮る。
// 途中では一切クラウドを叩かず、全部そろってから1回だけ送る。

// 問診の時間帯。
export type InterviewSlot = 'morning' | 'evening'

// 質問1つ。
//   text  … 声で答えてもらう質問
//   smile … 「笑ってください」と頼んでカメラで撮る質問
export interface InterviewQuestion {
  id: string
  text: string
  type: 'text' | 'smile'
}

// 1回分の問診の台本。
export interface InterviewScript {
  greeting: string // 問診のはじめの挨拶
  questions: InterviewQuestion[]
  closing: string // 問診の終わりのことば
}

// 問診への回答1つ。
export interface InterviewAnswer {
  questionId: string
  question: string // 分析するとき文脈がわかるよう、質問文も一緒に送る
  answer: string // 聞き取れなかったときは空文字
}

// 問診の分析結果（Lambdaから返ってくる形）。
// ★「元気度」は観察の目安であり、診断ではない（CLAUDE.md §2.5）。
export interface InterviewResult {
  vitality: number | null // 元気度 0〜100
  emoji: string
  level: AlertLevel
  smileScore: number | null // 笑顔スコア（撮れなかったときは null）
  baseline: number | null // ご本人の平常値
  message: string // 画面に出す一言（必ず観察的な表現）
  notified: boolean // ご家族へ通知したか
  source: 'mock' | 'aws'
}

// conversation.json 全体の形。非エンジニアはこのJSONだけ編集すれば会話を変えられる。
export interface ConversationData {
  openings: string[]
  intents: Intent[]
  controlPhrases: ControlPhrase[]
  fallback: string[]
  // 任意にしてあるので、古い conversation.json でも型エラーにならない。
  smileCheck?: SmileCheckConfig
  interview?: Record<InterviewSlot, InterviewScript>
}

// アバターの見た目の状態（待機 / 傾聴 / 発話）。
export type AvatarState = 'idle' | 'listening' | 'speaking'
