// 雑談の返事をAIに作ってもらうサービス。
//
// ★このファイルは「雑談」専用です（2026-07-28 変更）★
//   以前は問診の「相槌」もここで扱っていましたが、相槌はAIをやめ、
//   端末内で選ぶようにしました。相槌の実装は次の2つにあります。
//     ・語彙 … src/data/conversation.json の acknowledgements
//     ・選ぶ処理 … src/matching.ts の pickAcknowledgement()
//   やめた理由（詳しくは matching.ts のコメント）:
//     1. 1〜1.5秒の待ちが質問と質問の間に入り、問診がもたつく
//     2. AIが「〜ですか？」と質問を返し、質問が2つ並ぶ事故が起きる
//     3. 禁止語（CLAUDE.md §2.5）が混ざる可能性をゼロにできない
//   ※Lambda 側には相槌用の受け口（mode:"acknowledge"）が残してあります。
//     提出後にAIの相槌へ戻すときは、そこを呼ぶだけで済みます。
//
// ★reply() は「できなければ null を返す」約束です★
//   呼び出し側（useConversation）は null が返ってきたら
//   conversation.json の fallback のことばで返します。
//   つまりクラウドが落ちても、Wi-Fiが切れても、会話は止まりません。

import { postToLambda } from './apiClient'

export interface ChatService {
  /**
   * 雑談の返事を作る。
   * @param text 本人の発言
   * @param history 直前までのやりとり（「本人→アバター→本人→…」の交互）
   * @returns 返事。null = 作れなかった（呼び出し側が fallback に落とす）
   */
  reply(text: string, history: string[]): Promise<string | null>
}

// Lambda の chat アクションから返ってくる形。
interface ChatResponse {
  reply: string
}

// モック実装（?backend=mock のとき）。
// AIがいないので雑談の返事は作れません。常に null を返し、
// 呼び出し側が conversation.json の fallback を使ってくれます。
// ※外部通信ゼロを保証する経路なので、ここで通信を足さないこと。
export function createMockChatService(): ChatService {
  return {
    async reply() {
      return null
    },
  }
}

// AWS実装（?backend=aws のとき）。Lambda 経由で Gemini / Bedrock を呼びます。
export function createAwsChatService(): ChatService {
  return {
    async reply(text, history) {
      const res = await postToLambda<ChatResponse>('chat', { text, history })
      // 失敗しても例外は出ません（apiClient が必ず ok:false で返すため）。
      if (!res.ok || !res.data?.reply) return null
      return res.data.reply
    },
  }
}
