// AIホームパートナーのトップ画面。
//
// このファイルは「配置と配線」だけを担当する薄い層。
// 実際のロジックは hooks 側にまとまっている。
// - 会話内容の編集 … src/data/conversation.json（コードを触らず変更可）
// - 会話の司令塔   … src/hooks/useConversation
// - 問診の進行     … src/hooks/useInterview
// - 応答の判定    … src/matching.ts
// - 分析/通知     … src/services/*（mock / aws を切り替え）
// - 音声          … src/hooks/useSpeechSynthesis / useSpeechRecognition

import Avatar from './components/Avatar/Avatar'
import Captions from './components/Captions/Captions'
import SpeakButton from './components/Controls/SpeakButton'
import TextInputFallback from './components/Controls/TextInputFallback'
import StatusBadges from './components/StatusBadges/StatusBadges'
import SettingsMenu from './components/SettingsMenu/SettingsMenu'
import InterviewResultPanel from './components/InterviewResult/InterviewResultPanel'
import { useConversation } from './hooks/useConversation'
import { config } from './services'
import conversationData from './data/conversation.json'
import type { ConversationData } from './types'
import './App.css'

// JSONを型付きデータとして読み込む（非エンジニアはこのJSONだけ編集すればよい）。
const data = conversationData as ConversationData

function App() {
  const {
    avatarState,
    supported,
    avatarCaption,
    userCaption,
    mood,
    badges,
    interview,
    clearEmergency,
    onSpeakButton,
    submitText,
    startInterview,
  } = useConversation(data)

  // ボタンの文言は状態に応じて変える。
  const buttonLabel =
    avatarState === 'listening'
      ? '聞いています…'
      : avatarState === 'speaking'
        ? '話しています…'
        : '話す'

  return (
    <div className="app">
      {/* 非対応ブラウザ・マイクが使えない環境向けの案内 */}
      {!supported && (
        <div className="unsupported-banner">
          お使いのブラウザは音声機能に対応していません。Google Chrome でお試しください。
        </div>
      )}

      <SettingsMenu onStartInterview={startInterview} />

      <StatusBadges mood={mood} badges={badges} onCloseEmergency={clearEmergency} />

      <Avatar state={avatarState} />

      {/* 問診中は「3問目/5問」の進み具合を出す。今どこまで進んだか分かるようにする。 */}
      {interview.state === 'asking' && (
        <p className="interview-progress">
          {interview.questionNumber} / {interview.totalQuestions} 問目
        </p>
      )}

      {/* 分析中の案内。数秒かかるので黙って待たせない。 */}
      {interview.state === 'analyzing' && (
        <p className="interview-progress">ご様子をまとめています…</p>
      )}

      {/* 問診の結果パネル（デモの見せ場）。出ている間は字幕を隠す。 */}
      {interview.state === 'done' && interview.result ? (
        <InterviewResultPanel result={interview.result} onClose={interview.close} />
      ) : (
        <Captions avatarText={avatarCaption} userText={userCaption} />
      )}

      {/* 画面下部の操作エリア。ここに置いたものだけが下部の帯を使う。
          （以前は家族通知のトーストが同じ場所を取り合って重なっていた） */}
      <div className="app-controls">
        {/* 手入力の欄。?debug=1 のとき、または音声が使えない環境のときだけ出す。
            （マイクが使えなくてもデモを続けられるようにするための保険） */}
        {(config.debugInput || !supported) && (
          <TextInputFallback onSubmit={submitText} disabled={avatarState === 'speaking'} />
        )}

        <SpeakButton
          label={buttonLabel}
          onClick={onSpeakButton}
          disabled={!supported || avatarState !== 'idle'}
        />
      </div>
    </div>
  )
}

export default App
