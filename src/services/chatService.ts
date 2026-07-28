// 「短い自然文をAIに作らせる」仕事をまとめたサービス。
//
// 2つの用途があります。どちらも性質が同じなので1つのファイルにまとめています。
//   reply()       … 雑談の返事。キーワードに当たらなかったときに使う。
//   acknowledge() … 問診の途中で挟む「相槌」。回答を受け止める一言。
//
// ★どちらも「できなければ null を返す」約束です★
//   呼び出し側は null が返ってきたら、
//     雑談 … conversation.json の fallback のことばで返す
//     相槌 … 何も言わずに次の質問へ進む
//   ようにしてあります。つまりクラウドが落ちても会話・問診は止まりません。

import { postToLambda } from './apiClient'

export interface ChatService {
  /** 雑談の返事。null = 応答できなかった（呼び出し側が fallback に落とす）。 */
  reply(text: string, history: string[]): Promise<string | null>

  /** 問診の回答に対する一言の相槌。null = 生成できなかった（無言でスキップ）。 */
  acknowledge(answerText: string): Promise<string | null>
}

// 相槌を待つ時間の上限（ミリ秒）。
// ★雑談より短くしています★
//   相槌は「質問と質問の間」に挟まるので、ここで長く待つと
//   問診全体がもたついて感じられてしまうためです。
//   間に合わなければ相槌をあきらめて、すぐ次の質問へ進みます。
const ACK_TIMEOUT_MS = 2500

// モックが返す相槌の候補。AWSが無くても相槌つきの問診を試せるようにしておく。
// ※本番（aws）ではAIが回答の内容に合わせて作るので、この定型文は使われません。
const MOCK_ACKS = [
  'そうなんですね。',
  'なるほど、教えてくださってありがとうございます。',
  'そうでしたか。',
  'よくわかりました。',
]

// Lambda の chat アクションから返ってくる形。
interface ChatResponse {
  reply: string
}

export function createMockChatService(): ChatService {
  return {
    // モックでは雑談の返事を作れない（AIがいない）ので、常に null。
    // 呼び出し側が conversation.json の fallback を使ってくれます。
    async reply() {
      return null
    },

    // 相槌は定型文からランダムに選ぶ。少し待って「考えている」感じを出す。
    async acknowledge() {
      await new Promise((resolve) => setTimeout(resolve, 300))
      return MOCK_ACKS[Math.floor(Math.random() * MOCK_ACKS.length)]
    },
  }
}

export function createAwsChatService(): ChatService {
  return {
    async reply(text, history) {
      const res = await postToLambda<ChatResponse>('chat', { text, history })
      // 失敗しても例外は出ません（apiClient が必ず ok:false で返すため）。
      if (!res.ok || !res.data?.reply) return null
      return res.data.reply
    },

    async acknowledge(answerText) {
      const trimmed = answerText.trim()
      if (!trimmed) return null

      const res = await postToLambda<ChatResponse>(
        'chat',
        { text: trimmed, mode: 'acknowledge' },
        // ★待ち時間を短くする★（既定の config.timeoutMs より短い）
        ACK_TIMEOUT_MS,
      )
      if (!res.ok || !res.data?.reply) return null
      return res.data.reply
    },
  }
}

// 雑談も相槌も使わない設定（?ack=off / VITE_ACK=off）のときに使う実装。
// 「AIを呼ばない」ことをはっきりさせるため、あえて別の実装として用意しています。
export function createNullChatService(): ChatService {
  return {
    async reply() {
      return null
    },
    async acknowledge() {
      return null
    },
  }
}
