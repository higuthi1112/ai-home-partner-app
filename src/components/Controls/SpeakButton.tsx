// 「話す」ボタン。音声認識の開始トリガー。
// 自動起動が不安定な環境の保険として、大きなボタンを常に置いておく。

import './SpeakButton.css'

interface Props {
  label: string
  onClick: () => void
  disabled?: boolean
}

export default function SpeakButton({ label, onClick, disabled }: Props) {
  return (
    <button className="speak-button" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}
