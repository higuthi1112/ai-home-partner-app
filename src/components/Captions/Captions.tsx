// 字幕表示コンポーネント。
// アバターの発話内容と、聞き取った本人の言葉を大きな文字で表示する
// （耳が遠い人・デモ観客向け）。

import './Captions.css'

interface Props {
  avatarText: string // アバターがしゃべっている内容
  userText: string // 本人の聞き取り結果
}

export default function Captions({ avatarText, userText }: Props) {
  return (
    <div className="captions">
      <p className="caption-avatar">{avatarText}</p>
      <p className="caption-user">{userText}</p>
    </div>
  )
}
