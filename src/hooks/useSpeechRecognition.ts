// 音声認識（聞き取り）のラッパーフック。
// ja-JP・喋っている途中も字幕に出す（interimResults）設定。
// 認識の開始/停止を命令的に呼べるようにし、「誰がいつ聞くか」の制御は
// 上位（useConversation）に任せる。

import { useCallback, useRef, useState } from 'react'

// 呼び出し側が渡すコールバック群。
export interface RecognitionHandlers {
  // 認識結果（途中経過も含む）。isFinal=true で確定。
  onResult: (text: string, isFinal: boolean) => void
  // マイク不許可などのエラー時。
  onError?: () => void
}

export interface UseSpeechRecognition {
  isSupported: boolean
  start: (handlers: RecognitionHandlers) => void
  stop: () => void
}

// ブラウザによって名前が違うので両対応で取得する。
function getRecognitionCtor(): any {
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
}

export function useSpeechRecognition(): UseSpeechRecognition {
  const [isSupported] = useState(() => Boolean(getRecognitionCtor()))
  const recognitionRef = useRef<any>(null)

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(
    (handlers: RecognitionHandlers) => {
      const Ctor = getRecognitionCtor()
      if (!Ctor) return

      // 毎回新しいインスタンスを作ることで、コールバックが常に最新になる。
      const recognition = new Ctor()
      recognition.lang = 'ja-JP'
      recognition.interimResults = true
      recognition.continuous = false
      recognitionRef.current = recognition

      recognition.onresult = (event: any) => {
        let text = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          text += event.results[i][0].transcript
        }
        const isFinal = event.results[event.results.length - 1].isFinal
        handlers.onResult(text, isFinal)
      }

      recognition.onerror = () => {
        handlers.onError?.()
      }

      recognition.start()
    },
    [],
  )

  return { isSupported, start, stop }
}
