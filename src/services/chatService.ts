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

  /**
   * 問診の「追いかけ質問」を作る（2026-07-31 追加）。
   * 1問目の回答を掘り下げる質問を1つだけ作り、3問目の固定質問と入れ替える。
   * @param question 直前に尋ねた質問文
   * @param answer その回答
   * @returns 質問文。null = 使えなかった（呼び出し側は台本の固定文を読む）
   */
  followUpQuestion(question: string, answer: string): Promise<string | null>
}

// Lambda の chat アクションから返ってくる形。
interface ChatResponse {
  reply: string
}

// Lambda の followUp アクションから返ってくる形。
interface FollowUpResponse {
  question: string
}

// 追いかけ質問を待つ上限（ミリ秒）。
// ★長めでよい★
//   1問目に答えた直後から裏で作り始め、実際に使うのは3問目なので、
//   その間に2問目の読み上げと聞き取り（10〜15秒）が挟まります。
//   間に合わなければ固定文に落ちるだけなので、待ちすぎても害はありません。
const FOLLOWUP_TIMEOUT_MS = 8000

/**
 * ★AIが作った質問を使ってよいか確かめる（今回いちばん大事な処理）★
 *
 * プロンプトで「質問は1つだけ」と書いても、モデルが守る保証はありません。
 * 実際に過去、相槌をAIに作らせたとき **5回中5回が質問で終わり**、
 * 質問が2つ並んで会話が壊れた経緯があります（CLAUDE.md §7）。
 *
 * 「プロンプトを工夫すれば直る」と考えたくなりますが、
 * **確実さの問題であって表現力の問題ではありません。**
 * 確定的に防げるのは、こうして受け取った側で数えて弾くことだけです。
 *
 * @returns 使ってよければその文字列、だめなら null
 */
export function validateFollowUp(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null

  // 全角・半角どちらの疑問符も数える。
  const marks = (text.match(/[？?]/g) ?? []).length

  // ★2つ以上あれば質問が2つ＝過去に壊れた原因そのもの。捨てる。
  if (marks !== 1) return null

  // 疑問符で終わっていないものは、質問になっていないので捨てる。
  if (!/[？?]$/.test(text)) return null

  // 長すぎると聞き取れないうえ、字幕が伸びて画面のレイアウトが崩れる。
  if (text.length > 40) return null

  return text
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

    // モックの追いかけ質問。回答に出てきた言葉で選ぶだけの、簡単な仕組みです。
    // ★これはAIではありません★
    //   AWSが無くても「質問が差し替わる」流れを確認できるようにするための仮実装です。
    //   `?backend=mock` で動かしているときは「AIが質問を作っています」と
    //   説明できないことに注意してください。
    async followUpQuestion(_question, answer) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      const table: { keys: string[]; ask: string }[] = [
        { keys: ['痛', 'いた'], ask: '痛むのは、いつ頃から続いていますか？' },
        { keys: ['眠れ', 'ねむれ', '寝れ'], ask: '眠れない日は、何日くらい続いていますか？' },
        { keys: ['食べ', '食欲', 'ごはん'], ask: '食が進まないのは、いつ頃からですか？' },
        { keys: ['だるい', '疲れ', 'つかれ'], ask: 'だるさは、朝と夜のどちらが強いですか？' },
      ]
      const hit = table.find((t) => t.keys.some((k) => answer.includes(k)))
      return validateFollowUp(hit ? hit.ask : '今日は、どんなことをして過ごされましたか？')
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

    async followUpQuestion(question, answer) {
      const res = await postToLambda<FollowUpResponse>(
        'followUp',
        { question, answer },
        FOLLOWUP_TIMEOUT_MS,
      )
      if (!res.ok || !res.data?.question) return null
      // ★AIの出力をそのまま信用せず、必ず確認してから使う★
      return validateFollowUp(res.data.question)
    },
  }
}
