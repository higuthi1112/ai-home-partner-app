import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import FamilyDashboard from './components/FamilyDashboard/FamilyDashboard.tsx'
import DotGridBackground from './components/Background/DotGridBackground.tsx'

// StrictModeは開発時にuseEffectを2回実行するため、
// 音声認識/音声合成が二重に走ってしまう。デモの分かりやすさを優先し外している。

// URLの末尾が #family なら、本人用の画面ではなく家族用ダッシュボードを表示する。
// ログイン不要の「秘密のURL」方式（本格的な認証は今回のデモ範囲外）。
const isFamilyView = window.location.hash === '#family'

// 背景(DotGridBackground)は本人画面・家族ダッシュボードの共通の土台として
// ここで1つだけ描画する（画面が切り替わってもドット柄が途切れないように）。
createRoot(document.getElementById('root')!).render(
  <>
    <DotGridBackground />
    {isFamilyView ? <FamilyDashboard /> : <App />}
  </>,
)
