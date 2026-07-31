// 問診が終わったあとに、ご本人の画面へ中央に出すパネル。
//
// ★2026-07-31 大きく方針を変えた★
//   以前は元気度・平常値・笑顔スコアという「数字」を大きく出していた。
//   やめた理由は、ご本人にとって**点数を見せられること自体が不安のもと**だから。
//   「今日は38点でした」と言われて安心する人はいない。
//   このアプリは監視ではなくパートナーなので、ご本人には**ねぎらいの一言**だけを返す。
//
//   数字と詳しい分析は**ご家族のダッシュボード側**に出している（#family）。
//   見守る側には判断材料が要るが、見守られる側に点数は要らない、という切り分け。
//
// ★ただし「ご家族へお知らせした」ことだけは必ず伝える★
//   自分の情報が家族に送られたことを本人が知らないのは、監視に近づく。
//   知らせた事実を隠さないことが、信頼して使ってもらうための最低条件。
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
  // ご家族へ知らせた日だけ、枠の色を変えて「特別な日」だと分かるようにする。
  // ふだんの日は色をつけない（レベルで色を変えると、色そのものが点数になってしまう）。
  const panelClass = result.notified ? 'result-panel result-notified-day' : 'result-panel'

  return (
    <div className={panelClass}>
      <p className="result-title">今日もありがとうございました</p>

      {/* ご本人へのねぎらいの一言。ここがこのパネルの主役。
          Bedrock が書いた50文字程度のやさしい文が入る。 */}
      <p className="result-message">{result.message}</p>

      {/* ★ご家族へ知らせたときだけ出す★
          知らせていない日は、その旨をわざわざ書かない。
          「通知はありません」と毎日出すと、通知が目的の道具に見えてしまうため。 */}
      {result.notified && (
        <p className="result-notified">📩 ご家族にもお知らせしました</p>
      )}

      {/* 必ず入れる注意書き（CLAUDE.md §2.5）。小さくても消さないこと。 */}
      <p className="result-disclaimer">
        ※これは会話と表情から算出した目安であり、医学的な診断ではありません。
      </p>

      {/* 10秒たてば自動で閉じるが、待ちたくない人のためにボタンも残す。 */}
      <button className="result-close" onClick={onClose}>
        閉じる
      </button>
    </div>
  )
}
