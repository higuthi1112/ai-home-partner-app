// 手入力の欄（マイクが使えないときの保険）。
//
// なぜ必要か:
//   Chromeの音声認識は、じつは内部で音声をGoogleのサーバーへ送っています。
//   つまり会場のWi-Fiが落ちると、モードを mock に切り替えても
//   「音声認識そのもの」が動かなくなり、会話デモが成立しません。
//   そのときにキーボードで打ち込めば、音声で話したときとまったく同じ経路を通ります。
//
// 出し方:
//   URLに ?debug=1 を付ける。
//   開発中も、声を出さずに会話ロジックを試せるので便利です。

import { useState } from 'react'
import './TextInputFallback.css'

interface Props {
  onSubmit: (text: string) => void
  disabled: boolean
}

export default function TextInputFallback({ onSubmit, disabled }: Props) {
  const [text, setText] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    onSubmit(text)
    setText('')
  }

  return (
    <form className="text-fallback" onSubmit={handleSubmit}>
      <input
        type="text"
        className="text-fallback-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="ここに入力してEnter（マイクが使えないとき用）"
        disabled={disabled}
      />
      <button type="submit" className="text-fallback-button" disabled={disabled || !text.trim()}>
        送る
      </button>
    </form>
  )
}
