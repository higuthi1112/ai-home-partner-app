// カメラ（笑顔撮影）のラッパーフック。
//
// 「今何を撮るか」ではなく、カメラの起動・停止・撮影という
// 入出力だけを担当する。「いつ撮るか」は useConversation（問診の最後の質問）が決める。
//
// ★起動タイミングが重要★
//   getUserMedia は権限の確認に0.5〜2秒かかることがある。
//   「笑ってください」と言った直後に呼ぶと、演出が間に合わず不自然になる。
//   そのため、本人が最初に「話す」ボタンを押した時点（＝確実なユーザー操作）で
//   ストリームを起動し、そのままつなぎっぱなしにしておく。
//   （start() は何度呼んでも安全。起動済みなら何もしない）

import { useCallback, useEffect, useRef, useState } from 'react'
import { config } from '../services'

export interface UseCamera {
  isSupported: boolean
  isActive: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  // カメラを起動する。すでに起動していれば何もせず true を返す。
  start: () => Promise<boolean>
  // 今の映像を640x480のJPEGにして、base64文字列（data:URLの先頭は含まない）で返す。
  // カメラの準備ができていなければ null を返す。
  capture: () => string | null
  // カメラを止める（ランプが消える）。
  stop: () => void
}

export function useCamera(): UseCamera {
  // .env の VITE_CAMERA=off で丸ごと無効化できる（カメラの無いPCでの開発用）。
  const [isSupported] = useState(
    () => config.cameraEnabled && Boolean(navigator.mediaDevices?.getUserMedia),
  )
  const [isActive, setIsActive] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const start = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false
    if (streamRef.current) return true // すでに起動済み。何度呼んでも安全。

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // マイクは要らないので audio: false（音声認識と競合させないため）。
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // 自動再生がブロックされる環境もあるので、失敗しても無視する。
        await videoRef.current.play().catch(() => {})
      }
      setIsActive(true)
      return true
    } catch (err) {
      // 許可されなかった／カメラが無い等。ここで例外を投げず、呼び出し側には
      // false を返すだけにする（笑顔チェックが「撮れなかった」扱いで続けられるように）。
      console.warn('[useCamera] カメラを起動できませんでした', err)
      return false
    }
  }, [isSupported])

  const capture = useCallback((): string | null => {
    const video = videoRef.current
    // readyState >= 2 で「今の映像が描画できる状態」を意味する。
    if (!video || !streamRef.current || video.readyState < 2) return null

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    const canvas = canvasRef.current
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    // "data:image/jpeg;base64," の部分を取り除き、純粋なbase64文字列だけにする。
    return dataUrl.split(',')[1] ?? null
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setIsActive(false)
  }, [])

  // 画面を閉じるときはカメラのランプも消しておく。
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return { isSupported, isActive, videoRef, start, capture, stop }
}
