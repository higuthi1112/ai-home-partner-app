// 右上のハンバーガーボタンと、そこから開く設定パネル。
//
// ここには「見守りの時刻」を置いています。
//   ・起床時刻／就寝時刻を設定すると、その時刻になったら問診が自動で始まります。
//   ・その下の「いま始める」ボタンで、時刻に関係なく手動で始められます。
//
// ★「いま始める」ボタンはデモ当日の生命線★
//   発表は朝でも夜でもないので、時刻の自動起動を待っていては問診を見せられません。
//   このボタンがあれば、登壇中に確実に問診を開始できます。

import { useState } from 'react'
import type { InterviewSlot } from '../../types'
import { loadWatchTimes, saveWatchTimes } from '../../services/watchSchedule'
import './SettingsMenu.css'

interface Props {
  onStartInterview: (slot: InterviewSlot) => void
}

export default function SettingsMenu({ onStartInterview }: Props) {
  const [open, setOpen] = useState(false)
  const [times, setTimes] = useState(() => loadWatchTimes())

  // 時刻を変更したら、その場で localStorage にも保存する。
  const changeTime = (slot: InterviewSlot, value: string) => {
    const next = { ...times, [slot]: value }
    setTimes(next)
    saveWatchTimes(next)
  }

  // 問診を始めるときは設定パネルを閉じる（アバターの声が聞こえるように）。
  const start = (slot: InterviewSlot) => {
    setOpen(false)
    onStartInterview(slot)
  }

  return (
    <>
      {/* 右上のハンバーガーボタン */}
      <button className="menu-button" onClick={() => setOpen(true)} aria-label="設定を開く">
        <span />
        <span />
        <span />
      </button>

      {/* パネルが開いているときだけ、背景の暗幕とパネルを出す */}
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />

          <aside className="menu-panel" role="dialog" aria-label="設定">
            <div className="menu-header">
              <h2 className="menu-title">設定</h2>
              <button
                className="menu-close"
                onClick={() => setOpen(false)}
                aria-label="設定を閉じる"
              >
                ×
              </button>
            </div>

            <section className="menu-section">
              <h3 className="menu-section-title">見守りの時刻</h3>
              <p className="menu-note">
                設定した時刻になると、アバターから声をかけて今日のご様子をうかがいます。
              </p>

              <label className="menu-field">
                <span className="menu-field-label">☀️ 起床のころ</span>
                <input
                  type="time"
                  className="menu-time"
                  value={times.morning}
                  onChange={(e) => changeTime('morning', e.target.value)}
                />
              </label>

              <label className="menu-field">
                <span className="menu-field-label">🌙 おやすみのころ</span>
                <input
                  type="time"
                  className="menu-time"
                  value={times.evening}
                  onChange={(e) => changeTime('evening', e.target.value)}
                />
              </label>
            </section>

            <section className="menu-section">
              <h3 className="menu-section-title">いま始める</h3>
              <p className="menu-note">時刻を待たずに、その場で問診を始めます。</p>

              <button className="menu-action" onClick={() => start('morning')}>
                ☀️ 朝の問診を始める
              </button>
              <button className="menu-action" onClick={() => start('evening')}>
                🌙 夜の問診を始める
              </button>
            </section>
          </aside>
        </>
      )}
    </>
  )
}
