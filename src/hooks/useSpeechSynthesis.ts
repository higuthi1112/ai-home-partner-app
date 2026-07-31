// 音声合成（しゃべり）のラッパーフック。
//
// §6.5「音声の自然化（棒読み対策）」に対応した2段構え:
//   方針A（優先）: セリフに対応する事前生成MP3があれば、それを再生する（自然な声）。
//   方針B（フォールバック）: MP3が無いセリフは Web Speech API を自然寄りに調整して読み上げる。
//
// どちらも外部通信は行わない（同梱ファイル or ブラウザ内蔵の音声のみ）。

import { useCallback, useEffect, useRef, useState } from 'react'
import { audioManifest } from '../assets/audio/manifest'
// ※ services/index.ts ではなく config.ts を直接読む。
//   index.ts を読むとAWSサービスの生成まで走ってしまうため。
import { config } from '../services/config'
import { resolveVoice } from '../services/voicePreference'

export interface UseSpeechSynthesis {
  isSupported: boolean
  speak: (text: string, onEnd?: () => void) => void
  cancel: () => void
}

// 読み上げに使う声を決める処理は services/voicePreference.ts にまとめてある。
//
// ★2026-07-31 変更★
//   以前はここで `/natural|online|google/` に当たる声を1つ探していたが、
//   **iPhone の音声名は「Kyoko」「Otoya」なので1つも当たらず**、
//   結果として「最初に見つかった声」がそのまま使われていた（品質が選べていなかった）。
//   いまは端末ごとの手がかりで点数を付けて選び、
//   さらに**設定画面から本人が選べる**ようにしている（実機で聞き比べるため）。

// ※かつてここに splitIntoChunks（句読点で文を切る関数）があったが、
//   2026-07-31 に削除した。理由は speakWithSynthesis のコメントを参照。
//   「戻したほうが自然になるのでは」と思ったら、まず実機で聞き比べること。

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

  // 方針B: Web Speech API で読み上げる。
  //
  // ★2026-07-31 変更。文を区切って読ませるのをやめた★
  //   以前は句読点（。！？、）ごとに文を切り、**それぞれを別々の発話として**
  //   読ませていた。「間」を作って自然にする意図だったが、逆効果だった。
  //
  //   別々の発話にすると、読み上げエンジンはそれぞれを「1つの文」として扱う。
  //   そのため「では最後に、」のような**まだ続く語句にも文末の下がり調子**が付き、
  //   ぶつ切りに聞こえる。実機（iPhone）で「区切り方が不自然」と指摘されたのはこれ。
  //
  //   いまのエンジンは読点・句点の間を自分で適切に取れる。
  //   **文まるごと渡したほうが自然**になるので、そうしている。
  const speakWithSynthesis = useCallback((text: string, onEnd?: () => void) => {
    // 毎回ここで解決する。設定画面で声を変えたら、次の発話からすぐ反映されるようにするため。
    const voice = resolveVoice()

    let finished = false

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ja-JP'
    if (voice) utterance.voice = voice
    // 話す速さは config で決める（?rate=1.3 のようにURLでその場でも変えられる）。
    utterance.rate = config.speechRate
    utterance.pitch = 1.0
    utteranceRef.current = utterance // GC対策

    // onend/onerror が発火しないブラウザ不具合の保険。
    // ★文まるごとになったぶん、長さに応じて延ばすこと★
    //   固定の8秒のままだと、長いセリフの途中で「終わった」と誤判定して
    //   次の質問へ進んでしまう。日本語はおよそ1秒あたり6〜7文字なので、
    //   その見積もりに余裕を足している。
    const estimatedMs = (text.length / 6) * 1000 * (1 / config.speechRate)
    const safetyMs = Math.max(8000, Math.round(estimatedMs + 5000))

    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(safetyTimer)
      utteranceRef.current = null
      onEnd?.()
    }

    const safetyTimer = window.setTimeout(finish, safetyMs)

    utterance.onend = finish
    utterance.onerror = finish

    window.speechSynthesis.speak(utterance)
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
