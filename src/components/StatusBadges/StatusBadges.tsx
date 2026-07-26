// 画面上部の各種フィードバック表示をまとめたコンポーネント。
// - 気分スコア（絵文字＋数値）… 左上
// - 「本日 通知オフ」バッジ／家族へ通知しましたバッジ … 上部中央に縦積み
// - 緊急バナー（閉じるボタン付き）… 画面最上部・最前面
// - 動作モード表示（aws / mock）… 右下に極小
//
// ★2026-07-26 変更★
// 家族への通知は以前「画面下部のトースト」だったが、「話す」ボタンと
// 位置を取り合って重なっていたため、上部中央のバッジに移した。
// 問診の結果は情報量が多いので、中央の結果パネル（InterviewResult）で見せる。

import type { MoodState } from '../../services/analysisService'
import type { StatusBadges as Badges } from '../../hooks/useConversation'
import { backendMode } from '../../services'
import './StatusBadges.css'

interface Props {
  mood: MoodState
  badges: Badges
  onCloseEmergency: () => void
}

export default function StatusBadges({ mood, badges, onCloseEmergency }: Props) {
  return (
    <>
      {/* 気分スコア（左上）。分析中は点を揺らして「考えている」ことを伝える。 */}
      <div className="mood-badge" title="元気度（会話と表情から算出した目安です）">
        <span className="mood-emoji">{mood.emoji}</span>
        <span className="mood-score">{mood.score}</span>
        {mood.pending && <span className="mood-pending">…</span>}
      </div>

      {/* 上部中央のバッジ置き場（縦に積む） */}
      <div className="status-stack">
        {badges.notificationsSuppressed && (
          <div className="status-badge status-suppressed">🏥 本日 通知オフ</div>
        )}
        {badges.familyToast && (
          <div className="status-badge status-family">{badges.familyToast}</div>
        )}
      </div>

      {/* 緊急バナー（閉じるまで表示・常に最前面） */}
      {badges.emergency && (
        <div className="alert-banner">
          <span>{badges.emergency}</span>
          <button className="alert-close" onClick={onCloseEmergency}>
            閉じる
          </button>
        </div>
      )}

      {/* 今どちらで動いているか（右下・極小）。当日 mock へ退避したのを見落とさないため。 */}
      <div className={`mode-badge ${backendMode === 'aws' ? 'mode-aws' : 'mode-mock'}`}>
        {backendMode}
      </div>
    </>
  )
}
