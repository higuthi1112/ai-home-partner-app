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

// 雑談の進め方の設定（2026-07-29 追加）。
//
// ★なぜ必要か★
//   AIは放っておくと毎回「〜ですか？」と質問を返す。`CHAT_SYSTEM` に
//   「興味を持って一言たずね返してください」と書いてあるためで、仕様どおりの動作。
//   ただし高齢のご本人にとっては**尋問されている感じ**になり、疲れてしまう。
//   かといってAIに「3回に1回だけ質問して」と頼んでも、確率的な指示は守られない。
//   そこで**アプリ側で確定的に制御する**。
//
// ★見守りの精度は落ちない★
//   体調の情報は朝晩の問診で取る設計（CLAUDE.md §7）。雑談は補助的なので、
//   「話し相手として心地よいか」だけを基準に調整してよい。
export interface ChatFlowConfig {
  maxTurns: number // 何往復で締めるか（これを超えたら closing を添えて区切る）
  askQuestionOnTurn: number // 何ターン目だけ質問を許すか（1 = 最初の1回だけ）
  closing: string[] // 区切るときに添えることば
}

// 問診の途中で挟む「相槌」の語彙。
//
// ★AIは使わない（2026-07-28 決定）★
//   相槌は「一言受け止める」だけの短い定型文なので、AIに作らせる必要がない。
//   端末内で選べば、待ち時間ゼロ・通信ゼロ・費用ゼロになり、
//   さらに「相槌が質問で終わる」「禁止語が混ざる」事故が原理的に起こらない。
//   AIによる相槌は提出後の改良項目とする（CLAUDE.md §10）。
//
// ★判定は必ず negative を先に見ること★
//   「腰が痛みます」に「よかったですね」と返す事故を防ぐため。
//   逆に「痛くない」を negative と誤判定して同情しすぎる分には害が小さい。
//   迷ったら同情側に倒す、という非対称な設計にしてある。
export interface Acknowledgements {
  negativeKeywords: string[] // これが含まれたら negative の相槌
  positiveKeywords: string[] // これが含まれたら positive の相槌
  negative: string[]
  positive: string[]
  neutral: string[] // どちらでもないとき
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
  chat?: ChatFlowConfig
  acknowledgements?: Acknowledgements
  interview?: Record<InterviewSlot, InterviewScript>
}

// アバターの見た目の状態（待機 / 傾聴 / 発話）。
export type AvatarState = 'idle' | 'listening' | 'speaking'
