// 家族向けの見守りダッシュボード（URLの末尾に #family を付けると表示される）。
//
// ★読み取り専用・ログインなし★
// 「秘密のURL」を家族に伝える方式（本格的な認証(Cognito)は今回のデモ範囲外）。
// 本人の操作画面（App.tsx）とは完全に別の入口として main.tsx から出し分けている。
//
// ★表示する文章はすべて「観察」の言い回しにすること（CLAUDE.md §2.5）。
//   「診断」「うつ」などの語を、このファイルにも絶対に書かないこと。
// ★比較対象は必ずご本人の平常値。他人や一般値と比べる表現は書かないこと。

import { useEffect, useState } from 'react'
import { analysisService, backendMode } from '../../services'
import type { HistoryDay, HistorySummary } from '../../services/analysisService'
import type { AlertLevel } from '../../types'
import './FamilyDashboard.css'

// 平常値は直近14日の本人平均（CLAUDE.md §12の設計に合わせる）。
const HISTORY_DAYS = 14
const MAX_SCORE = 100

// 写真を出すのは直近7日ぶんだけ。
// ★これはLambda側の保存期間（7日で自動削除）と同じ数字にすること★
//   画面だけ長くしても、写真はもう消えているので「撮影なし」が並ぶことになります。
const PHOTO_DAYS = 7

function levelClass(level: AlertLevel): string {
  switch (level) {
    case 'EMERGENCY':
      return 'level-emergency'
    case 'WARNING':
      return 'level-warning'
    case 'GOOD':
      return 'level-good'
    default:
      return 'level-log'
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

// 1日ぶんの笑顔写真。
//
// ★写真は1枚ずつ、あとから取りに行く★
//   履歴と一緒に全部の写真を受け取ると、1回の通信が1MB近くになってしまいます。
//   このコンポーネントが自分の1枚だけを取りに行くことで、画面が先に出て、
//   写真は届いたものから順に表示されます。
//
// ★「無い」は異常ではありません★
//   写真は7日で自動的に消えるので、取れなかったときは静かに「撮影なし」と出します。
function DayPhoto({ day }: { day: HistoryDay }) {
  const [src, setSrc] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!day.photoSk) {
      setDone(true)
      return
    }
    analysisService.getPhoto(day.photoSk).then((base64) => {
      if (cancelled) return
      if (base64) setSrc(`data:image/jpeg;base64,${base64}`)
      setDone(true)
    })
    return () => {
      cancelled = true
    }
  }, [day.photoSk])

  return (
    <div className="photo-cell">
      <div className="photo-frame">
        {src ? (
          // 顔写真なので、代替テキストにも日付以上の説明は書かない。
          <img className="photo-img" src={src} alt={`${formatDate(day.date)}の様子`} />
        ) : (
          <span className="photo-empty">{done ? '撮影なし' : '…'}</span>
        )}
      </div>
      <span className="photo-date">{formatDate(day.date)}</span>
      {day.smileScore !== null && <span className="photo-score">笑顔 {day.smileScore}</span>}
    </div>
  )
}

export default function FamilyDashboard() {
  const [summary, setSummary] = useState<HistorySummary | null>(null)

  useEffect(() => {
    let cancelled = false
    analysisService.history(HISTORY_DAYS).then((data) => {
      if (!cancelled) setSummary(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!summary) {
    return (
      <div className="family-dashboard">
        <p className="family-loading">読み込み中…</p>
      </div>
    )
  }

  // グラフは古い日→新しい日の順で左から並べる（summary.days は新しい順で届く）。
  const days = [...summary.days].reverse()

  // 写真は新しい日を左に置く（見たいのは「最近」なので、直近を先頭にする）。
  // summary.days が新しい順で届くので、先頭から7日ぶんを取るだけでよい。
  const photoDays = summary.days.slice(0, PHOTO_DAYS)

  // いちばん新しい日（summary.days は新しい順で届く）。
  const latest = summary.days[0] ?? null

  return (
    <div className="family-dashboard">
      <header className="family-header">
        <h1>見守りダッシュボード</h1>
        <p className="family-sub">直近{HISTORY_DAYS}日間のご様子（読み取り専用）</p>
      </header>

      <section className="family-baseline">
        <p className="family-baseline-label">ご本人の平常値</p>
        <p className="family-baseline-value">
          {summary.baseline !== null ? summary.baseline : '—'}
        </p>
        {summary.baselineSampleCount < 3 && (
          <p className="family-baseline-note">
            まだ記録が{summary.baselineSampleCount}日分のため、平常値は参考程度です
          </p>
        )}
      </section>

      {/* いちばん新しい日のご様子。ご家族が最初に読むべき情報なので上のほうに置く。
          ★通知が飛ばない日（LOG/GOOD）でもここは出る★
            以前は通知が飛んだ日しか文章が無く、「少し不調だが通報には至らない日」が
            数字だけになっていた。その穴を埋めるための欄。 */}
      {latest && (latest.bodyNote || latest.moodNote) && (
        <section className="family-today">
          <p className="family-section-title">
            {formatDate(latest.date)} のご様子
          </p>

          {latest.bodyNote && (
            <div className="today-block">
              <span className="today-label">からだ</span>
              <p className="today-text">{latest.bodyNote}</p>
            </div>
          )}

          {latest.moodNote && (
            <div className="today-block">
              <span className="today-label">きもち</span>
              <p className="today-text">{latest.moodNote}</p>
            </div>
          )}

          {latest.suggestions && latest.suggestions.length > 0 && (
            <div className="today-suggest">
              <span className="today-label">いまできること</span>
              <ul className="today-list">
                {latest.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="family-chart">
        {days.length === 0 ? (
          <p className="family-empty">まだ記録がありません</p>
        ) : (
          <div className="family-bars">
            {days.map((day) => (
              <div className="family-bar-col" key={day.date}>
                <span className="family-bar-score">{day.vitality ?? '—'}</span>
                <div className="family-bar-track">
                  <div
                    className={`family-bar-fill ${levelClass(day.level)}`}
                    style={{ height: `${((day.vitality ?? 0) / MAX_SCORE) * 100}%` }}
                    title={`${day.date}: ${day.vitality ?? '—'}`}
                  />
                </div>
                <span className="family-bar-label">{formatDate(day.date)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 直近7日ぶんの笑顔。数字だけでは分からない「顔つきの変化」を見てもらう部分。 */}
      <section className="family-photos">
        <p className="family-section-title">最近の笑顔</p>
        {photoDays.length === 0 ? (
          <p className="family-empty">まだ写真がありません</p>
        ) : (
          <div className="photo-strip">
            {photoDays.map((day) => (
              <DayPhoto key={day.date} day={day} />
            ))}
          </div>
        )}
        <p className="family-photo-note">
          写真は{PHOTO_DAYS}日で自動的に消えます。それより前のものは残っていません。
        </p>
      </section>

      <section className="family-alerts">
        <p className="family-section-title">お知らせの履歴</p>
        {summary.alerts.length === 0 ? (
          <p className="family-empty">お知らせはありません</p>
        ) : (
          <ul className="family-alert-list">
            {summary.alerts.map((alert, i) => (
              <li key={i} className={`family-alert-item ${levelClass(alert.level)}`}>
                <span className="family-alert-time">{formatDateTime(alert.timestamp)}</span>
                <span className="family-alert-message">{alert.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="family-last-conversation">
        最後に会話した時刻：
        {summary.lastConversationAt ? formatDateTime(summary.lastConversationAt) : '記録なし'}
      </p>

      {/* 必ず入れる注意書き（CLAUDE.md §2.5）。 */}
      <p className="family-disclaimer">
        ※これは会話と表情から算出した目安であり、医学的な診断ではありません。
      </p>

      <div className={`family-mode-badge ${backendMode === 'aws' ? 'mode-aws' : 'mode-mock'}`}>
        {backendMode}
      </div>
    </div>
  )
}
