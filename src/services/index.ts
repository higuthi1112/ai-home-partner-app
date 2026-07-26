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

const useAws = config.backendMode === 'aws'

export const analysisService: AnalysisService = useAws
  ? createAwsAnalysisService()
  : createMockAnalysisService()

export const notificationService: NotificationService = useAws
  ? createAwsNotificationService()
  : createMockNotificationService()

// どのモードで動いているかをコンソールに出しておく（当日の事故防止）。
console.log(
  `[services] backend=${config.backendMode} / 分析の待ち方=${config.analysisSync ? '同期' : '非同期'}`,
)

// 画面（StatusBadges のモード表示など）から使えるように公開しておく。
export { config } from './config'
export const backendMode = config.backendMode
