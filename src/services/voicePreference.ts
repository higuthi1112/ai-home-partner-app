// アバターの「声」の選択を覚えておく。
//
// ★なぜ選べるようにしたのか（2026-07-31）★
//   読み上げに使えるのは、その端末に入っている音声だけ。
//   同じアプリでも Windows / Android / iPhone で声がまったく変わる。
//   しかも iPhone は「Kyoko」「Otoya」のように名前が素っ気なく、
//   名前から品質を見分けられない（拡張版もプレミアム版も同じ名前で並ぶ）。
//
//   コード側でうまく選ぼうとしても、開発機に入っていない音声は試せないため、
//   推測で条件を書くことになる。それでは当たったかどうかも確かめられない。
//   なので**実機で聞き比べて選んでもらう**方式にした。
//   当日、声がおかしいと感じたときに設定から差し替えられる利点もある。
//
// 保存先はブラウザの localStorage。外部へは送らない。

const STORAGE_KEY = 'hp.voiceURI'

/** 選ばれている声の識別子。未選択なら null（＝おまかせ）。 */
export function loadVoiceURI(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** 声を選ぶ。null を渡すと「おまかせ」に戻る。 */
export function saveVoiceURI(voiceURI: string | null): void {
  try {
    if (voiceURI) window.localStorage.setItem(STORAGE_KEY, voiceURI)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 保存できなくても読み上げ自体は動くので、ここでは何もしない。
  }
}

/** 日本語の音声だけを取り出す。 */
export function listJapaneseVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices().filter((v) => v.lang === 'ja-JP')
}

/**
 * おまかせのときに使う「良さそうな声」の選び方。
 *
 * ★端末ごとに手がかりが違う★
 *   Windows … 名前に "Natural"（Nanami 等の自然な音声）
 *   Android … 名前に "Google"
 *   iPhone  … **名前では分からない**。voiceURI に "compact" が入っているものが
 *             圧縮された低品質版で、拡張／プレミアム版はそれが付かない。
 *             （名前はどちらも「Kyoko」のままなので、名前を見ても区別できない）
 *
 * 点数の高い順に並べて先頭を返す。該当が無ければ最初の日本語音声。
 */
export function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined

  const score = (v: SpeechSynthesisVoice): number => {
    const name = v.name.toLowerCase()
    const uri = (v.voiceURI ?? '').toLowerCase()
    let s = 0
    if (/natural/.test(name)) s += 40 // Windows の自然な音声
    if (/google/.test(name)) s += 30 // Android / Chrome
    if (/premium|enhanced/.test(uri) || /premium|enhanced/.test(name)) s += 35 // iPhone の高品質版
    if (/compact/.test(uri)) s -= 30 // ★iPhone の圧縮版。いちばん機械的に聞こえる
    if (/online/.test(name)) s += 10
    if (v.localService === false) s += 5 // クラウド側の音声は概して自然
    return s
  }

  return [...voices].sort((a, b) => score(b) - score(a))[0]
}

/**
 * 実際に使う声を決める。選択があればそれ、無ければおまかせ。
 * 選ばれていた声が端末から消えている場合もあるので、見つからなければおまかせに落ちる。
 */
export function resolveVoice(): SpeechSynthesisVoice | undefined {
  const voices = listJapaneseVoices()
  const saved = loadVoiceURI()
  if (saved) {
    const hit = voices.find((v) => v.voiceURI === saved)
    if (hit) return hit
  }
  return pickDefaultVoice(voices)
}
