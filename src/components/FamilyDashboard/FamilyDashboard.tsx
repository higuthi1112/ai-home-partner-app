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
import type { HistorySummary } from '../../services/analysisService'
import type { AlertLevel } from '../../types'
import './FamilyDashboard.css'

// 平常値は直近14日の本人平均（CLAUDE.md §12の設計に合わせる）。
const HISTORY_DAYS = 14
const MAX_SCORE = 100

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
