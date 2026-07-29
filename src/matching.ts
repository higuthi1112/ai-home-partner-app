// 聞き取ったテキストから、どう応答するかを判定する「純粋関数」。
// UIやフックから切り離しておくことで、将来ここだけを
// Comprehend や LLM を使った高度な判定に差し替えられるようにしている。
//
// 判定の優先順位（§5.2）:
//   1. controlPhrases（制御フレーズ）を最優先で判定
//   2. 次に intents（通常の会話意図）を判定
//   3. どれにも当たらなければ fallback

import type { ConversationData, Intent, ControlPhrase } from './types'

export type MatchResult =
  | { type: 'control'; entry: ControlPhrase }
  | { type: 'intent'; entry: Intent }
  | { type: 'fallback' }

// キーワードが本文に部分一致するかどうかの単純判定。
function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

export function matchInput(text: string, data: ConversationData): MatchResult {
  // 1. 制御フレーズを最優先で確認
  const control = data.controlPhrases.find((phrase) => hasKeyword(text, phrase.keywords))
  if (control) return { type: 'control', entry: control }

  // 2. 通常の会話意図を確認
  const intent = data.intents.find((item) => hasKeyword(text, item.keywords))
  if (intent) return { type: 'intent', entry: intent }

  // 3. どれにも当たらなければ fallback
  return { type: 'fallback' }
}

// 配列からランダムに1つ選ぶ小さなヘルパー（応答候補・fallbackの選択に使う）。
export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

// 雑談の返事から、末尾の質問を取り除く純粋関数。
//
// ★なぜアプリ側で消すのか★
//   AIには `CHAT_SYSTEM` で「興味を持って一言たずね返してください」と
//   指示してあるため、返事はほぼ必ず「共感 → 質問」の形になる。
//   毎回質問されると尋問されている感じになり、高齢のご本人が疲れてしまう。
//   かといってAIに「3回に1回だけ質問して」と頼んでも、確率的な指示は守られない。
//   そこで「質問させたくないターンだけ、後から末尾の疑問文を落とす」ことにした。
//   AIが「共感＋質問」で書いてくれるおかげで、質問を外すと共感がきれいに残る。
//     例) 「そうですね、いいお天気ですね。今日はどこかお出かけされるんですか？」
//       → 「そうですね、いいお天気ですね。」
//
// ★返事まるごとが質問だったときは、何もしない★
//   落とすと空になってアバターが黙ってしまうため。
//   「質問を減らす」ことより「必ず何か返す」ことを優先する。
export function stripTrailingQuestion(reply: string): string {
  // 文の区切り（。！？）で分ける。区切り文字は各文の末尾に残す。
  const sentences = reply.match(/[^。！？!?]+[。！？!?]?/g)
  if (!sentences || sentences.length < 2) return reply

  // 末尾から続く疑問文をまとめて落とす（「〜ますか？〜のですか？」と2つ続く場合がある）。
  let end = sentences.length
  while (end > 0 && isQuestionSentence(sentences[end - 1])) end--

  // 1つも落とさない／全部落ちてしまう場合は、元のまま返す。
  if (end === sentences.length || end === 0) return reply

  const kept = sentences.slice(0, end).join('').trim()
  return kept.length > 0 ? kept : reply
}

// 質問を削ったあと、これを下回ったら「短すぎる」とみなす文字数。
// AIの返事が質問ばかりだと、削った残りが「そうですか。」だけになることがある。
// つらい話をした直後にこれだけ返ると冷たいので、相槌の語彙で言い直す。
const MIN_REPLY_CHARS = 10

// 雑談の返事を「質問しない・冷たくない」形に整える純粋関数。
//
// stripTrailingQuestion() だけだと、返事の大半が質問だったときに
// 「そうですか。」のような素っ気ない残りかすになってしまう。
// そこで短すぎる場合は、相槌の語彙（conversation.json の acknowledgements）から
// 相手の話の内容に合ったものを選び直す。
//   例) 「あまり眠れませんでした」への返事が「そうですか。」まで削れた場合
//     → 「それは、おつらかったですね。」に言い直す
//
// userText には「ご本人が言ったこと」を渡す（AIの返事ではない）。
// 相槌はご本人の発言内容から選ぶため。
export function softenChatReply(
  aiReply: string,
  userText: string,
  data: ConversationData,
): string {
  const stripped = stripTrailingQuestion(aiReply)
  if ([...stripped].length >= MIN_REPLY_CHARS) return stripped
  return pickAcknowledgement(userText, data) ?? stripped
}

// 1文が「質問」かどうかの判定。
//   ・「？」で終わる            … ほぼこれで当たる
//   ・「〜か。」で終わり8文字以上 … 「聞かせてもらえますか。」のような形を拾う。
//     8文字の下限は「そうですか。」(6文字)「そうでしたか。」(7文字)のような
//     相槌を質問と誤判定しないためのもの。
function isQuestionSentence(sentence: string): boolean {
  const s = sentence.trim()
  if (/[？?]\s*$/.test(s)) return true
  return s.length >= 8 && /か[。．]?\s*$/.test(s)
}

// 問診の回答に対する「相槌」を選ぶ純粋関数。
//
// ★AIを呼ばない★ 端末内だけで完結するので、
//   ・待ち時間ゼロ（AIに頼むと1〜1.5秒かかり、会場のWi-Fiではさらに延びる）
//   ・通信ゼロ・費用ゼロ
//   ・「相槌が質問で終わる」ことが起こりえない（このあと必ず次の質問が続くため）
//   ・禁止語（CLAUDE.md §2.5）が混ざることも起こりえない
//   という4つの性質が保証される。相槌は一言受け止めるだけのものなので、
//   AIに作らせる価値より、上の確実さのほうが大きいと判断した（2026-07-28）。
//
// ★判定は negative を先に見る★
//   「腰が痛みます」に「よかったですね」と返す事故を防ぐため。
//   語彙は conversation.json の acknowledgements にあり、コードには持たない。
//
// 戻り値が null になるのは、相槌の語彙が用意されていないときだけ。
// 呼び出し側は null なら相槌を飛ばして質問だけを読む。
export function pickAcknowledgement(answerText: string, data: ConversationData): string | null {
  const ack = data.acknowledgements
  if (!ack) return null

  const text = answerText.trim()
  if (!text) return null

  // 1. つらさを訴えていないか（最優先）
  if (hasKeyword(text, ack.negativeKeywords) && ack.negative.length > 0) {
    return pickRandom(ack.negative)
  }

  // 2. 良い知らせか
  if (hasKeyword(text, ack.positiveKeywords) && ack.positive.length > 0) {
    return pickRandom(ack.positive)
  }

  // 3. どちらとも言えないときは、当たりさわりのない受け止め方をする
  if (ack.neutral.length > 0) return pickRandom(ack.neutral)

  return null
}
