// アバターのセリフを、クラウド（Amazon Polly）で読み上げた音声にして取ってくる。
//
// ★なぜ必要か（2026-08-01）★
//   ブラウザ内蔵の読み上げは端末に入っている音声しか使えず、
//   iPhone で試したところ「機械音すぎて不自然」だった。
//   端末の設定（拡張音声の追加）でも改善しなかったため、
//   どの端末でも同じ品質になるようクラウドで作ることにした。
//
// ★ここが失敗しても、絶対に無音にはしない★
//   呼び出し側（useSpeechSynthesis）は、null が返ってきたら
//   端末内蔵の読み上げに切り替える。通信が落ちても会話は続く。
//
// ★同じセリフの音声は使い回す★
//   問診の質問は毎日同じなので、2回目からは通信せずに再生できる。
//   これをしないと、質問のたびに待ち時間が入って問診がもたつく。

import { postToLambda } from './apiClient'
import { config } from './config'

interface SpeakResponse {
  audioBase64: string
}

// 音声を待つ上限（ミリ秒）。
// ★長く待たないこと★
//   ここで待つ間、アバターは黙ったままになる。
//   間に合わなければ端末の音声で読み上げたほうが、会話としては自然。
const SPEAK_TIMEOUT_MS = 4000

// 一度作った音声を覚えておく場所（セリフ → 再生できるURL）。
// 画面を開いている間だけ持つ。閉じれば消えるので、端末には何も残らない。
const cache = new Map<string, string>()

// 覚えておく上限。問診の台本＋よく使う相槌でも数十件なので、これで足りる。
// 際限なく増やすと、長く開きっぱなしにしたとき端末のメモリを圧迫する。
const CACHE_LIMIT = 60

/**
 * セリフの音声を用意する。
 * @returns 再生できるURL。null = 用意できなかった（端末の音声で読むこと）
 */
export async function fetchSpeechUrl(text: string): Promise<string | null> {
  const key = text.trim()
  if (!key) return null

  // ?voice=device のときはクラウドを使わない（当日の退避）。
  if (!config.cloudVoiceEnabled) return null

  // mock のときは通信しない（外部通信ゼロを守るため）。
  if (config.backendMode !== 'aws') return null

  const cached = cache.get(key)
  if (cached) return cached

  const res = await postToLambda<SpeakResponse>('speak', { text: key }, SPEAK_TIMEOUT_MS)
  if (!res.ok || !res.data?.audioBase64) return null

  // base64 のままだと再生のたびに解釈が要るので、URLに変えて持っておく。
  const url = base64ToObjectUrl(res.data.audioBase64)
  if (!url) return null

  // 古いものから捨てる（入れた順に並んでいるので先頭が最も古い）。
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest) {
      URL.revokeObjectURL(cache.get(oldest)!)
      cache.delete(oldest)
    }
  }
  cache.set(key, url)
  return url
}

/**
 * これから使うセリフの音声を、先に用意しておく。
 * ★待たない★ 呼びっぱなしにして、実際に読み上げるときには届いている状態にする。
 * 問診を始めるときに質問をまとめて渡すと、質問ごとの待ち時間が無くなる。
 */
export function prefetchSpeech(texts: string[]): void {
  for (const t of texts) {
    // 失敗しても何もしない（そのときは端末の音声で読まれるだけ）。
    void fetchSpeechUrl(t).catch(() => {})
  }
}

// base64のMP3を、再生できるURLに変える。
function base64ToObjectUrl(base64: string): string | null {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
  } catch {
    return null
  }
}
