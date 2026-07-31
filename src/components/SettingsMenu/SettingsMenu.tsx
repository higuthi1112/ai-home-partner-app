// 右上のハンバーガーボタンと、そこから開く設定パネル。
//
// ここには「見守りの時刻」を置いています。
//   ・起床時刻／就寝時刻を設定すると、その時刻になったら問診が自動で始まります。
//   ・その下の「いま始める」ボタンで、時刻に関係なく手動で始められます。
//
// ★「いま始める」ボタンはデモ当日の生命線★
//   発表は朝でも夜でもないので、時刻の自動起動を待っていては問診を見せられません。
//   このボタンがあれば、登壇中に確実に問診を開始できます。

import { useEffect, useState } from 'react'
import type { InterviewSlot } from '../../types'
import { loadWatchTimes, saveWatchTimes } from '../../services/watchSchedule'
import {
  listJapaneseVoices,
  loadVoiceURI,
  resolveVoice,
  saveVoiceURI,
} from '../../services/voicePreference'
import { config } from '../../services/config'
import './SettingsMenu.css'

interface Props {
  onStartInterview: (slot: InterviewSlot) => void
}

export default function SettingsMenu({ onStartInterview }: Props) {
  const [open, setOpen] = useState(false)
  const [times, setTimes] = useState(() => loadWatchTimes())

  // 端末に入っている日本語の声と、選ばれている声。
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceURI, setVoiceURI] = useState<string | null>(() => loadVoiceURI())

  // ★声の一覧は遅れて届くことがある★
  //   getVoices() は最初の呼び出しで空の配列を返す環境がある（読み込みが非同期のため）。
  //   voiceschanged を待たないと、設定を開いても「選べません」と出てしまう。
  useEffect(() => {
    const load = () => setVoices(listJapaneseVoices())
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])

  const changeVoice = (uri: string | null) => {
    setVoiceURI(uri)
    saveVoiceURI(uri)
  }

  // 選んだ声で短い一言を読み上げる。聞き比べて決めてもらうため。
  const speakSample = () => {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance('こんにちは。今日の調子はいかがですか。')
    u.lang = 'ja-JP'
    const v = resolveVoice()
    if (v) u.voice = v
    u.rate = config.speechRate
    window.speechSynthesis.speak(u)
  }

  // いま実際に使われる声の名前（おまかせのときに何が選ばれたかを確かめる用）。
  const currentVoiceName = resolveVoice()?.name ?? '（見つかりません）'

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

            {/* ★声の選択★
                読み上げに使える声は端末に入っているものだけで、
                iPhone / Android / Windows でまったく変わる。
                コード側で「良い声」を当てにいっても開発機では確かめられないので、
                実機で聞き比べて選んでもらう作りにしている。
                当日、声がおかしいと感じたときの差し替え口にもなる。 */}
            <section className="menu-section">
              <h3 className="menu-section-title">アバターの声</h3>
              <p className="menu-note">
                この端末に入っている声から選べます。「聞いてみる」で試せます。
              </p>

              {voices.length === 0 ? (
                <p className="menu-note">この端末では声を選べません。</p>
              ) : (
                <>
                  <select
                    className="menu-select"
                    value={voiceURI ?? ''}
                    onChange={(e) => changeVoice(e.target.value || null)}
                  >
                    <option value="">おまかせ（自動で選ぶ）</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name}
                      </option>
                    ))}
                  </select>

                  <button className="menu-action" onClick={speakSample}>
                    🔊 聞いてみる
                  </button>

                  {/* 実機で「いまどれが使われているか」を確かめる手がかり。
                      iPhoneでは開発者ツールが開けないので、画面に出しておく。 */}
                  <p className="menu-note menu-voice-now">
                    いまの声: {currentVoiceName}
                  </p>
                </>
              )}
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
