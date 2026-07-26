// =====================================================================
// AIホームパートナー — Lambda 本体
// =====================================================================
// このファイル1つだけで動きます。AWSコンソールのコードエディタに
// まるごと貼り付けて「Deploy」を押してください。npm install も zip も不要です。
//
// このLambdaがやること:
//   1. 朝晩2回の「問診」の結果（全部の回答＋笑顔の写真）を受け取る
//   2. 写真は Rekognition で笑顔スコアにする
//   3. 回答と笑顔スコアと「ご本人の平常値」を Bedrock の Claude に渡し、
//      総合的に判断してもらう
//   4. 結果を DynamoDB に記録する
//   5. 心配な状態と判断されたときだけ、SNS でご家族の Gmail へ知らせる
//
// もう1つ、日常の雑談の返事を作る仕事もします（Gemini または Bedrock）。
//
// ★重要な設計方針★
//   ・写真は保存しません。メモリ上で分析してすぐ捨てます（S3を使いません）。
//   ・クラウドを使うのは「問診のとき」と「雑談の返事」だけです。
//   ・「元気度」は観察の目安であって、病気の診断ではありません。
//     Claude へのお願い文にもそのルールを書き込んでいます（PROMPT_RULES）。
//   ・比較するのは必ず「ご本人の過去」です。他人の平均とは比べません。
//     （DynamoDB の検索がユーザーID固定なので、そもそも他人のデータを読めません）
//   ・1日の呼び出し回数に上限を設けています。上限に達したらAIを呼ばずに
//     「今回はできませんでした」と返します（お金が青天井にならないように）。
// =====================================================================

import { RekognitionClient, DetectFacesCommand } from '@aws-sdk/client-rekognition'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb'

// ---------------------------------------------------------------------
// 【1】調整用の定数
// ---------------------------------------------------------------------
const BASELINE_DAYS = 14 // 平常値を計算するのに何日分さかのぼるか
const MIN_BASELINE_DAYS = 3 // 平常値がこの日数分たまるまで低下判定をしない
const DATA_RETENTION_DAYS = 90 // DynamoDB のデータを何日で自動削除するか（TTL）

// 同じ通知を連続で送らないための時間（分）。
// ★1日1回にすると、当日リハーサルで1回鳴らした後、本番で鳴らなくなります。
const RENOTIFY_WINDOW_MIN = 10
const RENOTIFY_WINDOW_EMERGENCY_MIN = 5

// ---------------------------------------------------------------------
// 【2】環境変数（Lambdaの「設定 > 環境変数」で設定します）
// ---------------------------------------------------------------------
const TABLE_NAME = process.env.TABLE_NAME ?? 'HomePartnerEvents'
const TOPIC_ARN = process.env.TOPIC_ARN ?? ''
const APP_KEY = process.env.APP_KEY ?? ''
const ADMIN_KEY = process.env.ADMIN_KEY ?? ''
const FAMILY_DASHBOARD_URL = process.env.FAMILY_DASHBOARD_URL ?? ''

// ★BedrockのモデルIDは必ず環境変数で渡すこと★
// 新しめのモデルは「推論プロファイル」という別のIDを求められることがあり
// （例: apac.anthropic.claude-... のような形）、素のモデルIDだと
// ValidationException になります。AWSコンソールの Bedrock の画面から
// 正確なIDをコピーして、この環境変数に貼ってください。
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? ''

// 雑談の返事を誰に作ってもらうか: gemini / bedrock / none
const CHAT_PROVIDER = process.env.CHAT_PROVIDER ?? 'none'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''
// Geminiのモデル名は変わることがあるので環境変数で渡す。
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'

// 1日の呼び出し上限（お金の見張り）。数字はコンソールで変えられる。
// 問診は実運用で1日2回なので、100あれば50倍の余裕がある。
const DAILY_LIMIT_ANALYSIS = Number(process.env.DAILY_LIMIT_ANALYSIS ?? 100)
const DAILY_LIMIT_CHAT = Number(process.env.DAILY_LIMIT_CHAT ?? 200)

// ---------------------------------------------------------------------
// 【3】AWSサービスへの接続（1回だけ作って使いまわす）
// ---------------------------------------------------------------------
// ※ハンドラの外に書くのがポイント。毎回作り直すと遅くなります。
const rekognition = new RekognitionClient({})
const bedrock = new BedrockRuntimeClient({})
const sns = new SNSClient({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// =====================================================================
// 【4】入口。フロントからのリクエストはすべてここに来ます。
// =====================================================================
export const handler = async (event) => {
  try {
    // --- ブラウザの事前確認(OPTIONS)には空返事する ---
    const method = event?.requestContext?.http?.method
    if (method === 'OPTIONS') return { statusCode: 204, body: '' }

    const body = parseBody(event)
    if (!body) return respond(400, { ok: false, error: 'リクエストの形式が正しくありません' })

    // --- 合言葉のチェック ---
    // ★AWSのサービスを1つも呼ばないうちに弾くのが重要。
    //   いたずらリクエストが来ても、ここで止まれば分析の料金が発生しません。
    if (!APP_KEY || body.appKey !== APP_KEY) {
      console.warn('[auth] appKey が一致しませんでした')
      return respond(403, { ok: false, error: '認証に失敗しました' })
    }

    const userId = body.userId ?? 'elder-001'
    console.log(`[handler] action=${body.action} userId=${userId}`)

    switch (body.action) {
      case 'analyzeInterview':
        return await analyzeInterview(body, userId)
      case 'chat':
        return await handleChat(body, userId)
      case 'notify':
        return await handleNotify(body, userId)
      case 'history':
        return await handleHistory(body, userId)
      case 'seed':
        return await handleSeed(body, userId)
      case 'deleteToday':
        return await handleDeleteToday(userId)
      default:
        return respond(400, { ok: false, error: `不明な action です: ${body.action}` })
    }
  } catch (err) {
    console.error('[handler] 予期しないエラー', err)
    return respond(200, { ok: false, error: 'サーバー側でエラーが発生しました' })
  }
}

// =====================================================================
// 【5】★中核★ 問診1回分をまとめて分析する
// =====================================================================
async function analyzeInterview(body, userId) {
  const answers = Array.isArray(body.answers) ? body.answers : []
  if (answers.length === 0) {
    return respond(200, { ok: false, error: '回答がありません' })
  }

  // --- お金の見張り。上限に達していたらAIを1つも呼ばずに帰る ---
  const allowed = await consumeDailyQuota(userId, 'analysis', DAILY_LIMIT_ANALYSIS)
  if (!allowed) {
    console.warn('[analyzeInterview] 本日の上限に達したため分析しませんでした')
    return respond(200, { ok: false, error: '本日の分析回数の上限に達しました' })
  }

  // --- 笑顔の写真を分析する（あれば） ---
  let smileScore = null
  if (body.imageBase64) {
    // ★写真そのものはログに出さないこと（出すと「保存しません」が嘘になります）。
    console.log(`[analyzeInterview] 画像を受信 (base64 ${body.imageBase64.length} 文字)`)
    smileScore = await detectSmile(body.imageBase64)
    // ※画像はこの関数を抜ければ破棄されます。どこにも保存していません。
  }

  // --- ご本人の平常値を出す（過去14日ぶんを1回のQueryで取得） ---
  const past = await queryEvents(userId, BASELINE_DAYS)
  const baseline = calcBaseline(past)

  // --- Claude に総合判断してもらう ---
  const judged = await judgeWithBedrock({
    slot: body.slot ?? 'morning',
    answers,
    smileScore,
    baseline,
  })

  // --- 記録する（画像は保存しない。回答は先頭30文字だけ） ---
  const now = new Date().toISOString()
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        userId,
        sk: `EVENT#${now}`,
        type: 'interview',
        slot: body.slot ?? 'morning',
        vitality: judged.vitality,
        level: judged.level,
        smileScore,
        answersExcerpt: answers.map((a) => ({
          questionId: a.questionId,
          answer: String(a.answer ?? '').slice(0, 30),
        })),
        createdAt: now,
        expiresAt: ttlEpoch(),
      },
    }),
  )

  // --- 心配なときだけご家族へ知らせる ---
  const notification = await maybeNotify(userId, judged.level, judged.familyMessage, {
    vitality: judged.vitality,
    baseline: baseline.average,
    smileScore,
  })

  return respond(200, {
    ok: true,
    userId,
    timestamp: now,
    vitality: judged.vitality,
    level: judged.level,
    smileScore,
    baseline: baseline.average,
    baselineSampleCount: baseline.count,
    message: judged.message,
    notification,
  })
}

// 笑顔の写真から「HAPPY（うれしい）」の確信度を取り出す。
async function detectSmile(base64) {
  try {
    const bytes = Buffer.from(base64, 'base64')
    const result = await rekognition.send(
      new DetectFacesCommand({ Image: { Bytes: bytes }, Attributes: ['ALL'] }),
    )
    const face = result.FaceDetails?.[0]
    if (!face) {
      console.log('[detectSmile] 顔が検出できませんでした')
      return null
    }
    const happy = face.Emotions?.find((e) => e.Type === 'HAPPY')
    return Math.round(happy?.Confidence ?? 0)
  } catch (err) {
    // 写真が分析できなくても問診全体は続ける。
    console.error('[detectSmile] 表情の分析に失敗しました', err)
    return null
  }
}

// =====================================================================
// 【6】Claude（Bedrock）への総合判断のお願い
// =====================================================================

// ★★★ 絶対に守らせるルール ★★★
// このアプリは医療機器ではありません。病名を出したり診断をしたりしてはいけません。
// これは法律（薬機法）と倫理の要請であり、言い回しの好みの問題ではありません。
const PROMPT_RULES = `
あなたは高齢者見守りアプリのアシスタントです。
朝または夜の問診の回答と、笑顔の写真から算出したスコアを読み、
ご本人の「元気度」を0〜100で見積もり、ご家族へ知らせるべきかを判断してください。

【絶対に守ること】
1. あなたは医師ではありません。病気の診断・判定は絶対にしないでください。
2. 次の言葉を出力に含めてはいけません:
   うつ / 認知症 / 診断 / 疑い / 異常 / 判定 / リスク / 病気 / 症状
3. 書いてよいのは「見たままの観察」だけです。
   良い例: 「よく眠れていて、笑顔もいつもどおりでした」
           「あまり眠れていないご様子です」
   悪い例: 「うつの疑いがあります」「異常が見られます」
4. 比較してよいのは「ご本人の平常値」だけです。他人や一般的な基準と比べないでください。
5. 出力は必ずJSONだけにしてください。前置きも説明も付けないでください。

【元気度のめやす】
  80〜100 … とても元気そう
  60〜79  … 元気そう
  41〜59  … ふつう
  21〜40  … 元気がなさそう
  0〜20   … かなり元気がなさそう

【レベルの決め方】
  EMERGENCY … 命に関わる訴え（強い痛み、息が苦しい、転倒、助けを求めている）がある
  WARNING   … 平常値より15以上低い、または体調不良のはっきりした訴えがある
  GOOD      … 平常値より10以上高い、または明らかに元気そう
  LOG       … 上のどれでもない（ふだんどおり）

【出力する形（この形以外は返さないこと）】
{
  "vitality": 62,
  "level": "LOG",
  "message": "画面に出す一言。ご本人向けにやさしく。30文字以内。",
  "familyMessage": "ご家族へ送る文。何があったかを具体的に。100文字以内。"
}
`.trim()

async function judgeWithBedrock({ slot, answers, smileScore, baseline }) {
  // モデルIDが未設定なら、AIを呼ばずに「判断できなかった」として返す。
  if (!BEDROCK_MODEL_ID) {
    console.warn('[judge] BEDROCK_MODEL_ID が未設定です')
    return fallbackJudgement(smileScore, baseline)
  }

  // Claude に読ませる材料を組み立てる。
  const qa = answers
    .map((a) => `Q: ${a.question ?? a.questionId}\nA: ${a.answer || '（お答えがありませんでした）'}`)
    .join('\n\n')

  const context = [
    `時間帯: ${slot === 'evening' ? '就寝前' : '起床後'}`,
    smileScore !== null
      ? `笑顔スコア: ${smileScore}（0〜100。写真から算出）`
      : '笑顔スコア: 撮影できませんでした',
    baseline.average !== null
      ? `ご本人の平常値: ${baseline.average}（過去${baseline.count}日の平均）`
      : `ご本人の平常値: まだ計測中です（あと${MIN_BASELINE_DAYS - baseline.count}日分必要）`,
  ].join('\n')

  try {
    const res = await bedrock.send(
      new InvokeModelCommand({
        modelId: BEDROCK_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 500,
          system: PROMPT_RULES,
          messages: [
            {
              role: 'user',
              content: `${context}\n\n【今回の問診】\n${qa}`,
            },
          ],
        }),
      }),
    )

    const payload = JSON.parse(new TextDecoder().decode(res.body))
    const text = payload?.content?.[0]?.text ?? ''
    const parsed = extractJson(text)

    if (!parsed) {
      console.warn('[judge] Claudeの返事をJSONとして読めませんでした:', text.slice(0, 200))
      return fallbackJudgement(smileScore, baseline)
    }

    // ★念のための最終チェック★
    // Claude が禁止語を書いてしまった場合に備え、こちら側でも弾く。
    const message = sanitize(parsed.message, 'いつもどおりの様子です')
    const familyMessage = sanitize(parsed.familyMessage, 'ご様子をお知らせします。')

    // 平常値がまだ足りないときは、低下による WARNING を出さない（誤検知防止）。
    let level = normalizeLevel(parsed.level)
    if (level === 'WARNING' && baseline.count < MIN_BASELINE_DAYS) {
      console.log('[judge] 平常値のサンプルが少ないため WARNING を LOG に下げました')
      level = 'LOG'
    }

    return {
      vitality: clamp(Number(parsed.vitality)),
      level,
      message,
      familyMessage,
    }
  } catch (err) {
    console.error('[judge] Bedrock の呼び出しに失敗しました', err)
    return fallbackJudgement(smileScore, baseline)
  }
}

// AIが使えなかったときの控えめな判定。
// ★勝手に「異常あり」とは言わない。分からないときは LOG にする。
function fallbackJudgement(smileScore, baseline) {
  const vitality = smileScore !== null ? smileScore : (baseline.average ?? 50)
  return {
    vitality: clamp(vitality),
    level: 'LOG',
    message: '今回はくわしく確認できませんでした',
    familyMessage: '',
  }
}

// Claude の返事から JSON の部分だけを取り出す。
// 前後によけいな文章が付いていても拾えるようにしておく。
function extractJson(text) {
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

// 禁止語が含まれていたら差し替える（最後の砦）。
const BANNED_WORDS = ['うつ', '鬱', '認知症', '診断', '疑い', '異常', '判定', '病気', '症状']

function sanitize(text, fallback) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value) return fallback
  const hit = BANNED_WORDS.find((w) => value.includes(w))
  if (hit) {
    console.warn(`[sanitize] 禁止語「${hit}」が含まれていたため差し替えました`)
    return fallback
  }
  return value
}

function normalizeLevel(level) {
  return ['EMERGENCY', 'WARNING', 'GOOD', 'LOG'].includes(level) ? level : 'LOG'
}

// =====================================================================
// 【7】雑談の返事を作る
// =====================================================================
async function handleChat(body, userId) {
  const text = String(body.text ?? '').trim()
  if (!text) return respond(200, { ok: false, error: 'テキストが空です' })

  // 「使わない」設定なら、AIを呼ばずにすぐ帰る。
  // フロントは返事が無いと conversation.json のことばで応答します。
  if (CHAT_PROVIDER === 'none') {
    return respond(200, { ok: false, error: '雑談機能は使用しない設定です' })
  }

  // お金（と無料枠）の見張り。
  const allowed = await consumeDailyQuota(userId, 'chat', DAILY_LIMIT_CHAT)
  if (!allowed) {
    console.warn('[chat] 本日の上限に達したため応答しませんでした')
    return respond(200, { ok: false, error: '本日の会話回数の上限に達しました' })
  }

  const history = Array.isArray(body.history) ? body.history.slice(-6) : []

  try {
    const reply =
      CHAT_PROVIDER === 'gemini'
        ? await chatWithGemini(text, history)
        : await chatWithBedrock(text, history)

    if (!reply) return respond(200, { ok: false, error: '返事を作れませんでした' })
    return respond(200, { ok: true, reply: sanitize(reply, 'そうなんですね。もう少し聞かせてください。') })
  } catch (err) {
    console.error('[chat] 応答の生成に失敗しました', err)
    return respond(200, { ok: false, error: '返事を作れませんでした' })
  }
}

// 雑談のときの、AIへのお願い文。
const CHAT_SYSTEM = `
あなたは高齢者に寄り添う話し相手です。次のことを守ってください。
・やさしく、短く、あたたかい日本語で話してください（60文字以内）。
・むずかしい言葉やカタカナ語は使わないでください。
・health・体調の話が出ても、病名を出したり診断をしたりしないでください。
・相手の話を否定せず、興味を持って一言たずね返してください。
・絵文字は使わないでください（読み上げると不自然になるため）。
`.trim()

async function chatWithGemini(text, history) {
  if (!GEMINI_API_KEY) {
    console.warn('[chat] GEMINI_API_KEY が未設定です')
    return null
  }

  const contents = [
    ...history.map((h, i) => ({
      role: i % 2 === 0 ? 'user' : 'model',
      parts: [{ text: String(h) }],
    })),
    { role: 'user', parts: [{ text }] },
  ]

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CHAT_SYSTEM }] },
        contents,
        generationConfig: { maxOutputTokens: 120 },
      }),
    },
  )

  // 429 は無料枠の使いすぎ。エラーにせず「返事なし」として扱う。
  if (res.status === 429) {
    console.warn('[chat] Gemini の無料枠の上限に達しました（429）')
    return null
  }
  if (!res.ok) {
    console.warn(`[chat] Gemini が ${res.status} を返しました`)
    return null
  }

  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null
}

async function chatWithBedrock(text, history) {
  if (!BEDROCK_MODEL_ID) {
    console.warn('[chat] BEDROCK_MODEL_ID が未設定です')
    return null
  }

  const messages = [
    ...history.map((h, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: String(h),
    })),
    { role: 'user', content: text },
  ]

  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 150,
        system: CHAT_SYSTEM,
        messages,
      }),
    }),
  )

  const payload = JSON.parse(new TextDecoder().decode(res.body))
  return payload?.content?.[0]?.text?.trim() ?? null
}

// =====================================================================
// 【8】1日の呼び出し回数の上限（お金の見張り）
// =====================================================================
// ★AWS Budgets は「知らせるだけ」で支払いを止めません。
//   実際に止められるのはこの仕組みだけです。
//
// DynamoDB の数値をアトミックに1つ増やし、上限を超えたら false を返します。
// （複数のリクエストが同時に来ても正しく数えられます）
async function consumeDailyQuota(userId, kind, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return true // 上限なしの設定

  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId, sk: `QUOTA#${kind}#${todayString()}` },
        UpdateExpression: 'ADD #c :one SET expiresAt = if_not_exists(expiresAt, :ttl)',
        ExpressionAttributeNames: { '#c': 'count' },
        ExpressionAttributeValues: { ':one': 1, ':ttl': ttlEpoch() },
        ReturnValues: 'UPDATED_NEW',
      }),
    )
    const count = res.Attributes?.count ?? 0
    if (count > limit) {
      console.warn(`[quota] ${kind} が本日の上限 ${limit} を超えました（${count}回目）`)
      return false
    }
    console.log(`[quota] ${kind} 本日 ${count}/${limit} 回目`)
    return true
  } catch (err) {
    // 数えられなかったときは通す（見張りの失敗で機能を止めない）。
    // ただし CloudWatch には必ず残す。
    console.error('[quota] 回数を数えられませんでした', err)
    return true
  }
}

// =====================================================================
// 【9】本人の制御フレーズによる通知（「助けて」「今日は病院」）
// =====================================================================
async function handleNotify(body, userId) {
  const controlAction = body.controlAction

  // 「今日は病院」→ その日の通知をお休みにする。メールは送らない。
  if (controlAction === 'suppressNotifications') {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          userId,
          sk: `SETTING#suppress#${todayString()}`,
          createdAt: new Date().toISOString(),
          reason: String(body.text ?? '').slice(0, 30),
          expiresAt: ttlEpoch(),
        },
      }),
    )
    return respond(200, {
      ok: true,
      userId,
      level: 'LOG',
      notification: { sent: false, reason: '本日の通知をお休みに設定しました' },
      message: '本日の通知をお休みにしました',
    })
  }

  // 「助けて」→ EMERGENCY。★これだけは問診を待たずに即座に送る。
  const level = controlAction === 'emergency' ? 'EMERGENCY' : 'WARNING'
  const excerpt = String(body.text ?? '').slice(0, 30)
  const familyMessage =
    level === 'EMERGENCY'
      ? `ご本人から助けを求めるお声がありました。「${excerpt}」`
      : `ご本人から体調について連絡がありました。「${excerpt}」`

  const notification = await maybeNotify(userId, level, familyMessage, {})

  return respond(200, {
    ok: true,
    userId,
    timestamp: new Date().toISOString(),
    level,
    notification,
    message: level === 'EMERGENCY' ? 'ご家族へ至急のお知らせを送りました' : 'ご家族へお知らせしました',
  })
}

// =====================================================================
// 【10】家族ダッシュボード用の履歴
// =====================================================================
async function handleHistory(body, userId) {
  const days = Math.min(Number(body.days ?? 7), BASELINE_DAYS)
  const events = await queryEvents(userId, BASELINE_DAYS)
  const byDay = groupByDay(events)

  const dayList = Object.keys(byDay)
    .sort()
    .reverse()
    .slice(0, days)
    .map((date) => {
      const d = byDay[date]
      return {
        date,
        vitality: d.vitality,
        smileScore: d.smileScore,
        // 朝と夜、それぞれの元気度（グラフで2点打つため）
        morning: d.morning,
        evening: d.evening,
        level: d.level ?? 'LOG',
      }
    })

  const alerts = await queryAlerts(userId, BASELINE_DAYS)
  const baseline = calcBaseline(events)

  return respond(200, {
    ok: true,
    userId,
    days: dayList,
    baseline: baseline.average,
    baselineSampleCount: baseline.count,
    alerts: alerts.map((a) => ({
      timestamp: a.sk.replace('ALERT#', ''),
      level: a.level,
      message: a.body ?? '',
    })),
    lastConversationAt: events.length > 0 ? events[events.length - 1].createdAt : null,
  })
}

// =====================================================================
// 【11】デモ用のサンプルデータ投入（adminKey が必要）
// =====================================================================
// ★発表では必ず「過去分はデモ用のサンプルデータです」と断ってください。
async function handleSeed(body, userId) {
  if (!ADMIN_KEY || body.adminKey !== ADMIN_KEY) {
    return respond(403, { ok: false, error: 'adminKey が違います' })
  }

  // 平常値が 58〜62 くらいで推移し、直近2日だけ 40台に落ちる形にする。
  // こうすると「最近すこし元気がないようです」が数字で裏づけられます。
  const items = []
  for (let i = BASELINE_DAYS; i >= 1; i--) {
    const recent = i <= 2
    for (const slot of ['morning', 'evening']) {
      const day = new Date(Date.now() - i * 86400000)
      day.setUTCHours(slot === 'morning' ? 0 : 12, 0, 0, 0)
      const vitality = recent ? 40 + rand(9) : 55 + rand(12)
      items.push({
        PutRequest: {
          Item: {
            userId,
            sk: `EVENT#${day.toISOString()}`,
            type: 'interview',
            slot,
            vitality,
            smileScore: vitality + rand(6) - 3,
            level: recent ? 'WARNING' : 'LOG',
            createdAt: day.toISOString(),
            seeded: true,
            expiresAt: ttlEpoch(),
          },
        },
      })
    }
  }

  for (let i = 0; i < items.length; i += 25) {
    await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: items.slice(i, i + 25) } }))
  }
  return respond(200, { ok: true, userId, seeded: items.length })
}

// =====================================================================
// 【12】本人による当日データ削除（自己コントロール権）
// =====================================================================
async function handleDeleteToday(userId) {
  const today = todayString()
  const events = await queryEvents(userId, 2)
  const targets = events.filter((e) => toJstDate(e.sk.replace('EVENT#', '')) === today)
  if (targets.length === 0) return respond(200, { ok: true, deleted: 0 })

  for (let i = 0; i < targets.length; i += 25) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: targets
            .slice(i, i + 25)
            .map((t) => ({ DeleteRequest: { Key: { userId, sk: t.sk } } })),
        },
      }),
    )
  }
  return respond(200, { ok: true, deleted: targets.length })
}

// =====================================================================
// 【13】通知の送信
// =====================================================================
async function maybeNotify(userId, level, familyMessage, detail) {
  // GOOD と LOG では通知しない（仕様書の「通知を抑える設計」）。
  if (level !== 'WARNING' && level !== 'EMERGENCY') {
    return { sent: false, reason: 'レベルが LOG / GOOD のため送信していません' }
  }

  // 「今日は病院」で通知オフにしていたら WARNING は送らない。
  // ★ただし EMERGENCY は安全側に倒して必ず送ります。
  if (level === 'WARNING') {
    const suppressed = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId, sk: `SETTING#suppress#${todayString()}` },
      }),
    )
    if (suppressed.Item) {
      return { sent: false, reason: '本日は通知をお休みに設定されています' }
    }
  }

  // 短時間に同じレベルを連投しない。
  const windowMin = level === 'EMERGENCY' ? RENOTIFY_WINDOW_EMERGENCY_MIN : RENOTIFY_WINDOW_MIN
  const recent = await queryAlerts(userId, 1)
  const cutoff = Date.now() - windowMin * 60 * 1000
  const dup = recent.find(
    (a) => a.level === level && new Date(a.sk.replace('ALERT#', '')).getTime() > cutoff,
  )
  if (dup) {
    return { sent: false, reason: `直近${windowMin}分に同じ通知を送信済みのためスキップしました` }
  }

  const text = buildMailBody(level, familyMessage, detail)
  const subject = level === 'EMERGENCY' ? MAIL_SUBJECT_EMERGENCY : MAIL_SUBJECT_WARNING

  let messageId = null
  let result = 'ok'
  try {
    const res = await sns.send(
      new PublishCommand({ TopicArn: TOPIC_ARN, Subject: subject, Message: text }),
    )
    messageId = res.MessageId ?? null
  } catch (err) {
    console.error('[sns] 送信に失敗しました', err)
    result = 'failed'
  }

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        userId,
        sk: `ALERT#${new Date().toISOString()}`,
        level,
        channel: 'email',
        messageId,
        result,
        body: familyMessage || '',
        expiresAt: ttlEpoch(),
      },
    }),
  )

  return {
    sent: result === 'ok',
    channel: 'email',
    level,
    reason: result === 'ok' ? null : '送信に失敗しました',
  }
}

// =====================================================================
// 【14】メールの文面
// =====================================================================
// ★★★ 絶対に守ること ★★★
// 「うつ」「認知症」「診断」「疑い」「異常」「判定」といった
// 病気を思わせる言葉は使わないこと。これは法律（薬機法）と倫理の要請です。
// 使ってよいのは「最近、笑顔が少ないようです」のような“見たままの観察”だけです。

// SNS の件名は ASCII（半角英数）しか使えません。日本語を入れると送信が拒否されます。
const MAIL_SUBJECT_WARNING = '[AI Home Partner] Notice'
const MAIL_SUBJECT_EMERGENCY = '[AI Home Partner] URGENT'

// すべてのメールの末尾に必ず付ける注意書き。
const DISCLAIMER = [
  '※これは会話と表情から算出した目安であり、医学的な診断ではありません。',
  '※ご本人の普段の様子と比べた変化をお知らせしています。',
].join('\n')

function buildMailBody(level, familyMessage, detail) {
  const now = new Date()
  const lines = []

  if (level === 'EMERGENCY') {
    lines.push('AIホームパートナーからの至急のお知らせです。', '')
    lines.push(familyMessage || 'ご本人から助けを求めるお声がありました。')
    lines.push('至急ご連絡をお願いします。', '')
  } else {
    lines.push('AIホームパートナーからのお知らせです。', '')
    if (familyMessage) lines.push(familyMessage, '')
    if (typeof detail.vitality === 'number') {
      const base = detail.baseline !== null && detail.baseline !== undefined
        ? `（いつもは ${detail.baseline} くらいです）`
        : ''
      lines.push(`本日の元気度は ${detail.vitality} でした。${base}`)
    }
    lines.push('お時間のあるときに、お電話してみませんか。', '')
  }

  lines.push(`・記録時刻: ${todayString()} ${jstTimeString(now)}`)
  lines.push('')
  lines.push(DISCLAIMER)

  if (FAMILY_DASHBOARD_URL) {
    lines.push('', 'くわしい記録はこちら:', FAMILY_DASHBOARD_URL)
  }
  return lines.join('\n')
}

// =====================================================================
// 【15】DynamoDB の読み書きと集計
// =====================================================================

// 直近 days 日分のイベントをまとめて取得する（1回のQueryで済ませる）。
async function queryEvents(userId, days) {
  const from = new Date(Date.now() - days * 86400000).toISOString()
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :u AND sk BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':u': userId, // ★ここが固定なので、他人のデータは構造的に読めません
        ':from': `EVENT#${from}`,
        ':to': `EVENT#${new Date().toISOString()}`,
      },
      Limit: 200,
    }),
  )
  return res.Items ?? []
}

async function queryAlerts(userId, days) {
  const from = new Date(Date.now() - days * 86400000).toISOString()
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :u AND sk BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':u': userId,
        ':from': `ALERT#${from}`,
        ':to': `ALERT#${new Date().toISOString()}`,
      },
      ScanIndexForward: false,
      Limit: 50,
    }),
  )
  return res.Items ?? []
}

// イベントを日付ごとにまとめる。
// ★日付は必ず日本時間で切ること。
//   記録は世界標準時(UTC)なので、朝9時(JST)の出来事は UTC では前日になります。
//   そのまま前から10文字を切ると「今日のデータが空」になり、朝のデモで詰みます。
function groupByDay(events) {
  const byDay = {}
  for (const e of events) {
    if (typeof e.vitality !== 'number') continue
    const date = toJstDate(e.sk.replace('EVENT#', ''))
    if (!byDay[date]) {
      byDay[date] = { vitality: null, smileScore: null, morning: null, evening: null, level: null }
    }
    const d = byDay[date]
    if (e.slot === 'evening') d.evening = e.vitality
    else d.morning = e.vitality

    // その日の代表値は、朝と夜の平均（片方だけならその値）。
    const both = [d.morning, d.evening].filter((v) => typeof v === 'number')
    d.vitality = Math.round(both.reduce((a, b) => a + b, 0) / both.length)
    if (typeof e.smileScore === 'number') d.smileScore = e.smileScore
    d.level = e.level ?? d.level
  }
  return byDay
}

// ご本人の平常値（今日を除いた過去の平均）を出す。
// ★参照しているのは同じ userId のデータだけ。他人とは比べません。
function calcBaseline(events) {
  const byDay = groupByDay(events)
  const today = todayString()
  const pastScores = Object.keys(byDay)
    .filter((d) => d !== today)
    .map((d) => byDay[d].vitality)
    .filter((v) => typeof v === 'number')

  const count = pastScores.length
  const average =
    count >= MIN_BASELINE_DAYS
      ? Math.round(pastScores.reduce((a, b) => a + b, 0) / count)
      : null

  return { average, count }
}

// =====================================================================
// 【16】こまごました道具
// =====================================================================

// リクエストのボディを JSON として取り出す。
// ※Content-Type は見ません（フロントは CORS 対策で text/plain を使っています）。
function parseBody(event) {
  try {
    let raw = event?.body ?? ''
    if (event?.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  }
}

function clamp(n) {
  if (!Number.isFinite(n)) return 50
  return Math.max(0, Math.min(100, Math.round(n)))
}

// 日本時間での「今日」の日付文字列（YYYY-MM-DD）。
// ※Lambda は世界標準時(UTC)で動くので、9時間足して日本時間に直しています。
function todayString() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// 日本時間での「10時12分」のような文字列。
function jstTimeString(date) {
  const jst = new Date(date.getTime() + 9 * 3600 * 1000)
  return `${jst.getUTCHours()}時${String(jst.getUTCMinutes()).padStart(2, '0')}分`
}

// UTCのISO文字列を、日本時間での日付（YYYY-MM-DD）に直す。
function toJstDate(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// TTL（自動削除）の時刻。エポック秒で入れる決まり。
function ttlEpoch() {
  return Math.floor((Date.now() + DATA_RETENTION_DAYS * 86400000) / 1000)
}

function rand(n) {
  return Math.floor(Math.random() * n)
}
