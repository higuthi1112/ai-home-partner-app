// 分析サービスの「AWS版」。
// Lambda Function URL を叩いて、Rekognition（笑顔）と Comprehend（会話の感情）の
// 分析結果を受け取ります。AWS SDK はここでも使いません（apiClient経由のfetchだけ）。
//
// ★重要な設計★
// Lambda は「絶対値」を返してきます（今の値に足し算した結果ではない）。
// フロント側で加算しないのがポイントで、こうしておくと
// 分析結果が届く順番が前後しても、スコアがおかしくなりません。

import type { AlertLevel, Mood } from '../types'
import { postToLambda } from './apiClient'
import { config } from './config'
import {
  createMockAnalysisService,
  type AnalysisService,
  type HistorySummary,
  type MoodState,
} from './analysisService'

// Lambda から返ってくるJSONの形。
interface AnalyzeResponse {
  vitality: {
    score: number | null
    emoji: string
    mood: Mood
    smileScore: number | null
    sentiment: string | null
  }
  baseline: { average: number | null; sampleCount: number; delta: number | null }
  level: 'EMERGENCY' | 'WARNING' | 'LOG' | 'GOOD'
  message: string
}

// 問診の分析結果として Lambda から返ってくるJSONの形。
interface InterviewAnalyzeResponse {
  vitality: number | null
  level: AlertLevel
  smileScore: number | null
  baseline: number | null
  message: string
  notification?: { sent: boolean; reason?: string | null }
}

// スコアから絵文字を決める（モック実装と同じ基準にそろえる）。
function emojiFromScore(score: number | null): string {
  if (score === null) return '😐'
  if (score >= 60) return '😊'
  if (score <= 40) return '😟'
  return '😐'
}

export function createAwsAnalysisService(): AnalysisService {
  // initial() と update() は通信の必要がないので、モックのものをそのまま借ります。
  // （画面が立ち上がった瞬間にLambdaを叩きにいかないようにするため）
  const local = createMockAnalysisService()

  return {
    initial() {
      return { ...local.initial(), source: 'aws' }
    },

    update(current, intentMood) {
      return local.update(current, intentMood)
    },

    async analyze(current, input) {
      // 会話テキストとカメラ画像で、Lambda側の呼び先が変わります。
      const action = input.imageBase64 ? 'analyzeFace' : 'analyzeText'
      const payload = input.imageBase64
        ? { imageBase64: input.imageBase64 }
        : { text: input.text ?? '', intentMood: input.intentMood ?? 'neutral' }

      const res = await postToLambda<AnalyzeResponse>(action, payload)

      // 通信に失敗しても、会話は止めない。今の値をそのまま返します。
      // （画面上は「さっきのスコアのまま」になるだけで、アバターは喋り続けます）
      if (!res.ok || !res.data) {
        console.warn('[awsAnalysisService] 分析できなかったので現在の値を維持します')
        return { ...current, pending: false, source: 'aws' }
      }

      const { vitality, baseline, level, message } = res.data

      // Lambda がまだスコアを出せない場合（データが1件も無いときなど）は現状維持。
      if (vitality.score === null) {
        return { ...current, pending: false, source: 'aws', level, message }
      }

      return {
        score: vitality.score,
        emoji: vitality.emoji,
        mood: vitality.mood,
        smileScore: vitality.smileScore,
        sentiment: vitality.sentiment,
        baseline: baseline.average,
        level,
        message,
        pending: false,
        source: 'aws',
      }
    },

    // 問診1回分をまとめて分析する。★クラウドを叩くのはここだけ（1日2回）。
    // 回答が多く画像も乗るので、通信の待ち時間は長めにとる。
    async analyzeInterview(input) {
      const res = await postToLambda<InterviewAnalyzeResponse>(
        'analyzeInterview',
        {
          slot: input.slot,
          answers: input.answers,
          imageBase64: input.imageBase64 ?? null,
        },
        // 画像の送信とAI分析があるため、通常より長く待つ（既定5秒では足りない）。
        20000,
      )

      // 分析できなかったときも、画面には正直に「今回は記録できませんでした」と出す。
      // ★送れていないのに「ご家族へ通知しました」と表示しないこと。
      if (!res.ok || !res.data) {
        console.warn('[awsAnalysisService] 問診の分析ができませんでした')
        return {
          vitality: null,
          emoji: '😐',
          level: 'LOG' as AlertLevel,
          smileScore: null,
          baseline: null,
          message: '今回は記録できませんでした（電波の状態をご確認ください）',
          notified: false,
          source: 'aws' as const,
        }
      }

      const { vitality, level, smileScore, baseline, message, notification } = res.data
      return {
        vitality,
        emoji: emojiFromScore(vitality),
        level,
        smileScore,
        baseline,
        message,
        notified: notification?.sent ?? false,
        source: 'aws',
      }
    },

    async history(days) {
      const res = await postToLambda<HistorySummary>('history', { days })

      // 履歴が取れなかったときは、空のまとめを返す。
      // ダッシュボードは「まだ記録がありません」と表示する作りにしてあります。
      if (!res.ok || !res.data) {
        console.warn('[awsAnalysisService] 履歴を取得できませんでした')
        return {
          userId: config.userId,
          days: [],
          baseline: null,
          baselineSampleCount: 0,
          alerts: [],
          lastConversationAt: null,
        }
      }

      return res.data
    },
  }
}

// MoodState を他ファイルから型として参照できるように再エクスポートしておく。
export type { MoodState }
