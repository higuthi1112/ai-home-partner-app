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
