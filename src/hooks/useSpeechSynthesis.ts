// 音声合成（しゃべり）のラッパーフック。
//
// §6.5「音声の自然化（棒読み対策）」に対応した2段構え:
//   方針A（優先）: セリフに対応する事前生成MP3があれば、それを再生する（自然な声）。
//   方針B（フォールバック）: MP3が無いセリフは Web Speech API を自然寄りに調整して読み上げる。
//
// どちらも外部通信は行わない（同梱ファイル or ブラウザ内蔵の音声のみ）。

import { useCallback, useEffect, useRef, useState } from 'react'
import { audioManifest } from '../assets/audio/manifest'

export interface UseSpeechSynthesis {
  isSupported: boolean
  speak: (text: string, onEnd?: () => void) => void
  cancel: () => void
}

// ja-JPの声の中から、より自然な声（Natural / Online / Google を含む名前）を優先的に選ぶ。
// 無ければ最初のja-JP声にフォールバックする。
function pickNaturalVoice(): SpeechSynthesisVoice | undefined {
  const jaVoices = window.speechSynthesis.getVoices().filter((v) => v.lang === 'ja-JP')
  const preferred = jaVoices.find((v) => /natural|online|google/i.test(v.name))
  return preferred ?? jaVoices[0]
}

// 句読点（。！？、）の直後で文を区切る。読み上げに「間（ま）」を作るため。
function splitIntoChunks(text: string): string[] {
  const chunks = text
    .split(/(?<=[。！？、])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return chunks.length > 0 ? chunks : [text]
}

export function useSpeechSynthesis(): UseSpeechSynthesis {
  const [isSupported] = useState(() => 'speechSynthesis' in window)

  // Chromeは発話中の Utterance への参照が無いと、途中でGCされ onend が発火しなく
  // なることがある。それを防ぐため再生中の Utterance を保持しておく。
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  // 方針Aで再生中の audio 要素を保持（cancel時に止めるため）。
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const cancel = useCallback(() => {
    if (isSupported) window.speechSynthesis.cancel()
    utteranceRef.current = null
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }, [isSupported])

  // アンマウント時に発話を止める。
  useEffect(() => cancel, [cancel])

  // 方針A: 事前生成したMP3を再生する。
  const speakWithAudioFile = useCallback((url: string, onEnd?: () => void) => {
    const audio = new Audio(url)
    audioRef.current = audio
    const finish = () => {
      audioRef.current = null
      onEnd?.()
    }
    audio.onended = finish
    audio.onerror = finish
    audio.play().catch(finish) // 再生できなければ即終了扱い
  }, [])

  // 方針B: Web Speech API を自然寄りに調整して読み上げる。
  const speakWithSynthesis = useCallback((text: string, onEnd?: () => void) => {
    const voice = pickNaturalVoice()
    const chunks = splitIntoChunks(text)

    let chunkIndex = 0
    let finished = false
    let safetyTimer = 0

    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(safetyTimer)
      utteranceRef.current = null
      onEnd?.()
    }

    const speakNext = () => {
      if (chunkIndex >= chunks.length) {
        finish()
        return
      }
      const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex])
      chunkIndex += 1
      utterance.lang = 'ja-JP'
      if (voice) utterance.voice = voice
      utterance.rate = 0.95 // 少しゆっくりめで落ち着いたトーンに
      utterance.pitch = 1.0
      utteranceRef.current = utterance // GC対策

      // 次の塊との間に短い「間」を空けてから読む。
      utterance.onend = () => window.setTimeout(speakNext, 120)
      utterance.onerror = finish

      // onend/onerror が発火しないブラウザ不具合の保険（塊ごとに延長）。
      window.clearTimeout(safetyTimer)
      safetyTimer = window.setTimeout(finish, 8000)

      window.speechSynthesis.speak(utterance)
    }

    speakNext()
  }, [])

  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!isSupported) {
        onEnd?.()
        return
      }
      cancel() // 前の発話が残っていたら止める

      const audioUrl = audioManifest[text]
      if (audioUrl) {
        speakWithAudioFile(audioUrl, onEnd) // 方針A
      } else {
        speakWithSynthesis(text, onEnd) // 方針B
      }
    },
    [isSupported, cancel, speakWithAudioFile, speakWithSynthesis],
  )

  return { isSupported, speak, cancel }
}
