// ご家族への通知サービス。
//
// このファイルには「インターフェース（約束ごと）」と「モック実装」が入っています。
// AWSを使う実装は awsNotificationService.ts にあり、どちらを使うかは index.ts が決めます。
//
// mock … 画面にメッセージを出すだけ（外部通信ゼロ）
// aws  … Lambda経由で SNS からご家族のGmailへメールを送る
//
// ★notify() と send() の使い分け★
//   notify() は「その場ですぐ画面に出す文言」を返す同期の関数。
//   send()   は「実際にメールを送る」非同期の関数。
//   会話フックはまず notify() で即座にトーストを出し、裏で send() を走らせて、
//   送信が終わったら文言を差し替えます。こうすると体験が一切遅れません。

import type { AlertLevel, ControlAction } from '../types'

export interface NotificationResult {
  action: ControlAction
  message: string // 画面に出す説明文
  sent?: boolean // 実際に送信できたか（awsのときのみ意味を持つ）
  level?: AlertLevel
}

// 通知に添える状況（メール本文の材料になる）。
export interface NotifyContext {
  text?: string // 聞き取ったテキスト
  vitality?: number // そのときの元気度
}

export interface NotificationService {
  // すぐ画面に出す文言を返す（同期・通信しない）。
  notify(action: ControlAction): NotificationResult

  // 実際の送信を行う（非同期）。失敗しても reject しないこと。
  send(action: ControlAction, context?: NotifyContext): Promise<NotificationResult>
}

// アクションごとの画面表示メッセージ。
const MESSAGES: Record<ControlAction, string> = {
  suppressNotifications: '🏥 本日 通知オフ',
  notifyFamily: '📩 ご家族へお知らせしています…',
  emergency: '🚨 ご家族へ至急のお知らせをしています…',
  // 笑顔チェックは通知ではないので、この文言は基本的に使われません。
  smileCheck: '📷 お顔を確認しています…',
}

export function createMockNotificationService(): NotificationService {
  return {
    notify(action) {
      // 実際の送信はせず、コンソールに記録するだけ（動作確認用）。
      console.log(`[notificationService(mock)] notify: ${action}`)
      return { action, message: MESSAGES[action] }
    },

    async send(action) {
      // モックでは「送ったつもり」になるだけ。少し待って完了扱いにする。
      await new Promise((resolve) => setTimeout(resolve, 500))
      console.log(`[notificationService(mock)] send: ${action}（実際には送っていません）`)

      const message =
        action === 'suppressNotifications'
          ? '🏥 本日 通知オフ（デモ）'
          : action === 'emergency'
            ? '🚨 ご家族へ緊急のお知らせを送りました（デモ）'
            : '📩 ご家族へお知らせしました（デモ）'

      return { action, message, sent: true }
    },
  }
}
