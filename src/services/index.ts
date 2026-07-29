// サービス層の入口。
//
// ここで「モック実装」と「AWS実装」を切り替えます。
// アプリの他の場所（components / hooks）は、どちらが使われているかを気にせず、
// このファイルから import した analysisService / notificationService を呼ぶだけでよい。
//
// 切り替え方は3通り（詳しくは config.ts）:
//   1. .env の VITE_BACKEND_MODE=aws
//   2. URLに ?backend=aws を付ける（デモ当日はこちらで退避できる）
//   3. 上のどちらでも、Lambda の URL が未設定なら自動で mock になる（事故防止）

import { config } from './config'
import { createMockAnalysisService, type AnalysisService } from './analysisService'
import { createAwsAnalysisService } from './awsAnalysisService'
import { createMockNotificationService, type NotificationService } from './notificationService'
import { createAwsNotificationService } from './awsNotificationService'
import { createAwsChatService, createMockChatService, type ChatService } from './chatService'

const useAws = config.backendMode === 'aws'

export const analysisService: AnalysisService = useAws
  ? createAwsAnalysisService()
  : createMockAnalysisService()

export const notificationService: NotificationService = useAws
  ? createAwsNotificationService()
  : createMockNotificationService()

// 雑談の返事を作るサービス。
//
// ★2026-07-28 変更: このサービスは「雑談」専用になった★
//   問診の相槌はAIをやめ、端末内で選ぶようにしたため（matching.ts の
//   pickAcknowledgement を useConversation が直接呼ぶ）。
//   以前はここで ?ack=off のときに雑談まで止めていたが、
//   ?ack=off は「相槌をやめる」設定であって雑談を止める設定ではないので、
//   相槌の判定を useConversation 側へ移したのに合わせて切り離した。
//   AIを丸ごと止めたいときは ?backend=mock を使う（外部通信ゼロになる）。
export const chatService: ChatService = useAws
  ? createAwsChatService()
  : createMockChatService()

// どのモードで動いているかをコンソールに出しておく（当日の事故防止）。
console.log(
  `[services] backend=${config.backendMode} / 分析の待ち方=${config.analysisSync ? '同期' : '非同期'} / 相槌=${config.acknowledgeEnabled ? 'あり（端末内で選択）' : 'なし'}`,
)

// 画面（StatusBadges のモード表示など）から使えるように公開しておく。
export { config } from './config'
export const backendMode = config.backendMode
