// 画面全体の背景（インタラクティブなドットグリッド）。
//
// 仕組み: 同じ間隔のドット柄を2枚重ねる。
//   ベース層 … 常に見えている小さいドット
//   ホバー層 … 大きいドット。CSSの mask-image でカーソル周辺の円形だけ見せている
// マウスを動かすたびにマスクの中心座標(x, y)を更新することで、
// 「カーソルの近くだけ点が大きく浮かび上がる」ように見せている。
//
// ★App.tsx / FamilyDashboard.tsx の外側（main.tsx）に1つだけ置く★
// 画面が変わってもドットの模様が途切れないよう、共通の背景として1箇所にまとめている。
//
// ★pointermoveはこの要素ではなくwindowで拾う★
// この背景は一番奥（z-index: 0）にあり、.app 側は透明でも画面いっぱいの大きさを
// 持っているため、マウスの当たり判定は常に手前の .app 側が拾ってしまい、
// この要素自身に onPointerMove を付けても発火しない。window に直接つけることで、
// 手前に何があってもカーソル位置を確実に取得できるようにしている。

import { useEffect, useState } from 'react'
import './DotGridBackground.css'

// 円の中心から何pxまでを「完全に大きいドット」にするか、
// 何pxで「完全に元のドットに戻す（透明）」にするかの半径。
const MASK_FULL_RADIUS = 72
const MASK_FADE_RADIUS = 120

export default function DotGridBackground() {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [hovering, setHovering] = useState(false)

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      setPos({ x: e.clientX, y: e.clientY })
      setHovering(true)
    }
    // マウスがブラウザの表示領域そのものから出たときだけ発火する
    // （<html>要素の外＝ウィンドウの外に出た、とみなせる）。
    const handleLeaveWindow = () => setHovering(false)

    window.addEventListener('pointermove', handleMove)
    document.documentElement.addEventListener('mouseleave', handleLeaveWindow)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      document.documentElement.removeEventListener('mouseleave', handleLeaveWindow)
    }
  }, [])

  const maskImage = `radial-gradient(circle at ${pos.x}px ${pos.y}px, #000 ${MASK_FULL_RADIUS}px, transparent ${MASK_FADE_RADIUS}px)`

  return (
    <div className="dot-bg">
      <div className="dot-bg-base" />
      <div
        className="dot-bg-hover"
        style={{
          opacity: hovering ? 1 : 0,
          WebkitMaskImage: maskImage,
          maskImage,
        }}
      />
    </div>
  )
}
