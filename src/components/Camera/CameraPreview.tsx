// カメラの小さなプレビュー。
//
// 常時、画面の隅に小さく表示しておく。
// 「今カメラが動いています」が見えること自体が、
// 「監視ではなくパートナー」というコンセプトの実演になる（何を撮っているか隠さない）。
//
// ★配置の注意★
//   以前、画面下部で「話す」ボタンと家族通知のトーストが同じ場所を取り合って
//   重なるバグがあった。同じ轍を踏まないよう、このプレビューは position:absolute を
//   使わず、App.tsx の中で通常のレイアウトの流れに乗せている
//   （CameraPreview.css の align-self で右端に寄せているだけで、他の要素と
//   重なりようがない）。
//
// 笑顔チェック中は少し拡大して、今何をしているのかを伝える。

import type { UseCamera } from '../../hooks/useCamera'
import './CameraPreview.css'

interface Props {
  camera: UseCamera
  expanded: boolean
}

export default function CameraPreview({ camera, expanded }: Props) {
  // カメラが使えない環境（許可なし・カメラ無し・VITE_CAMERA=off）では何も出さない。
  if (!camera.isSupported) return null

  return (
    <div
      className={`camera-preview ${expanded ? 'camera-preview-expanded' : ''}`}
      title="カメラは見守りのためだけに使い、映像は保存しません"
    >
      <video ref={camera.videoRef} className="camera-video" muted playsInline />
      {!camera.isActive && <span className="camera-off-hint">📷</span>}
    </div>
  )
}
