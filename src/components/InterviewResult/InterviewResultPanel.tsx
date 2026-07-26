// 問診が終わったあとに、中央に出す結果パネル。
//
// ここがデモの見せ場になります。
// 「AIが分析して、いつもと比べて、必要なときだけ家族に知らせた」
// という一連の流れが1枚で伝わるようにしています。
//
// ★表示する文章はすべて「観察」の言い回しにすること（CLAUDE.md §2.5）。
//   「診断」「うつ」などの語を、このファイルにも絶対に書かないこと。

import type { InterviewResult } from '../../types'
import './InterviewResultPanel.css'

interface Props {
  result: InterviewResult
  onClose: () => void
}

export default function InterviewResultPanel({ result, onClose }: Props) {
  // レベルごとに枠の色を変える。WARNING は落ち着いたオレンジ（赤は緊急だけに使う）。
  const levelClass =
    result.level === 'EMERGENCY'
      ? 'result-emergency'
      : result.level === 'WARNING'
        ? 'result-warning'
        : result.level === 'GOOD'
          ? 'result-good'
          : 'result-log'

  return (
    <div className={`result-panel ${levelClass}`}>
      <p className="result-title">今日のご様子</p>

      {/* 元気度（特大の数字）。測れなかったときは「—」を出す。 */}
      <div className="result-score">
        <span className="result-emoji">{result.emoji}</span>
        <span className="result-number">{result.vitality ?? '—'}</span>
      </div>

      {/* ★ご本人の平常値との比較。他人とは比べていないことが一目で分かる書き方にする。 */}
      {result.baseline !== null && result.vitality !== null && (
        <p className="result-baseline">
          いつもは {result.baseline} くらい／今日は {result.vitality}
        </p>
      )}

      <p className="result-message">{result.message}</p>

      {/* 笑顔スコアは補足情報として小さく添える。 */}
      {result.smileScore !== null && (
        <p className="result-smile">笑顔スコア {result.smileScore}</p>
      )}

      {/* 家族へ通知したかどうかを正直に出す。
          ★送れていないのに「通知しました」と表示しないこと。 */}
      <p className="result-notified">
        {result.notified
          ? '📩 ご家族へお知らせしました'
          : 'ご家族への通知はありません'}
      </p>

      {/* 必ず入れる注意書き（CLAUDE.md §2.5）。 */}
      <p className="result-disclaimer">
        ※これは会話と表情から算出した目安であり、医学的な診断ではありません。
      </p>

      <button className="result-close" onClick={onClose}>
        閉じる
      </button>
    </div>
  )
}
