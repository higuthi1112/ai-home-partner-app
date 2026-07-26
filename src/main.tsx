import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictModeは開発時にuseEffectを2回実行するため、
// 音声認識/音声合成が二重に走ってしまう。デモの分かりやすさを優先し外している。
createRoot(document.getElementById('root')!).render(<App />)
