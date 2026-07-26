// 通知サービスの「AWS版」。
// Lambda Function URL を叩いて、SNS からご家族のGmailへメールを送ってもらいます。
//
// notify() は同期のまま（画面にすぐ文言を出す役）。
// send() だけが実際にLambdaを呼びます。

import { postToLambda } from './apiClient'
import {
  createMockNotificationService,
  type NotificationResult,
  type NotificationService,
} from './notificationService'

interface NotifyResponse {
  level: 'EMERGENCY' | 'WARNING' | 'LOG' | 'GOOD'
  notification: { sent: boolean; channel?: string; reason?: string | null }
  message: string
}

export function createAwsNotificationService(): NotificationService {
  // notify()（画面に出すだけの同期処理）はモックと同じでよいので借ります。
  const local = createMockNotificationService()

  return {
    notify(action) {
      return local.notify(action)
    },

    async send(action, context): Promise<NotificationResult> {
      // 笑顔チェックは通知ではないので、Lambdaの通知処理は呼びません。
      if (action === 'smileCheck') {
        return { action, message: '', sent: false }
      }

      const res = await postToLambda<NotifyResponse>('notify', {
        controlAction: action,
        text: context?.text ?? '',
      })

      // 送信に失敗したときは、その旨を画面に出す。
      // ★「送れませんでした」と正直に出すこと。送れていないのに
      //   「送りました」と表示するのは、見守りアプリとして最もやってはいけないことです。
      if (!res.ok || !res.data) {
        console.warn('[awsNotificationService] 通知を送れませんでした')
        return {
          action,
          message: '⚠️ ご家族へのお知らせを送れませんでした（電波の状態をご確認ください）',
          sent: false,
        }
      }

      const { notification, level } = res.data

      // Lambda 側の判断で「送らなかった」場合（通知オフ設定・連投防止など）。
      if (!notification.sent) {
        const reason = notification.reason ?? ''
        if (action === 'suppressNotifications') {
          return { action, message: '🏥 本日 通知オフ', sent: false, level }
        }
        return {
          action,
          message: `📭 今回はお知らせを送りませんでした${reason ? `（${reason}）` : ''}`,
          sent: false,
          level,
        }
      }

      const sentMessage =
        action === 'emergency'
          ? '🚨 ご家族へ至急のお知らせを送りました ✅'
          : '📩 ご家族へメールを送信しました ✅'

      return { action, message: sentMessage, sent: true, level: level }
    },
  }
}

// 画面側で使えるよう、Lambdaが返した一言も型として公開しておく。
export type { NotificationResult }
