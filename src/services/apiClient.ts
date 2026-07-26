// Lambda Function URL を叩くための共通処理。
//
// ★このファイルが、アプリの中で fetch を書いてよい唯一の場所です。★
// components や hooks から直接 fetch しないこと（CLAUDE.md §2）。
//
// 設計上の約束が3つあります。
//   1. 例外を投げない。失敗しても必ず { ok: false } を返す。
//      → 通信が失敗しても会話が止まらないようにするため。
//   2. 指定時間で打ち切る。
//      → 会場のWi-Fiが遅いとき、アバターが黙ったままになるのを防ぐため。
//   3. Content-Type は text/plain を使う。
//      → application/json にすると、ブラウザが本番のリクエストの前に
//        「送っていいですか？」という確認(OPTIONS)を1往復ぶん余計に送ります。
//        text/plain なら確認が省かれ、往復が半分になります。
//        Lambda 側は Content-Type を見ずに JSON として解釈するので問題ありません。
//        同じ理由でカスタムヘッダーも使わず、合言葉は本文に入れています。

import { config } from './config'

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}

export async function postToLambda<T>(
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs: number = config.timeoutMs,
): Promise<ApiResult<T>> {
  if (!config.lambdaUrl) {
    return { ok: false, error: 'Lambda の URL が設定されていません' }
  }

  // 指定時間を過ぎたらリクエストを中断するための仕掛け。
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(config.lambdaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        appKey: config.appKey,
        userId: config.userId,
        action,
        ...payload,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn(`[apiClient] HTTP ${response.status} が返りました (action=${action})`)
      return { ok: false, error: `サーバーが ${response.status} を返しました` }
    }

    const data = (await response.json()) as T & { ok?: boolean; error?: string }

    // Lambda 側は「想定内の失敗」を HTTP 200 + { ok: false } で返す約束。
    if (data.ok === false) {
      console.warn(`[apiClient] 処理に失敗しました (action=${action}):`, data.error)
      return { ok: false, error: data.error }
    }

    return { ok: true, data }
  } catch (err) {
    // 通信エラー・タイムアウト・JSONの解析失敗などはすべてここに来る。
    // ★ここで例外を投げ直さないこと。呼び出し側（会話）を止めないための設計です。
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    const message = aborted ? `${timeoutMs}ms で応答がありませんでした` : '通信に失敗しました'
    console.warn(`[apiClient] ${message} (action=${action})`, err)
    return { ok: false, error: message }
  } finally {
    window.clearTimeout(timer)
  }
}
