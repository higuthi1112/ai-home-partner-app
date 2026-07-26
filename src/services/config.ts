// アプリ全体の設定を1箇所にまとめる場所。
//
// 設定の読み取り順は「URLのクエリ → localStorage → .env」。
// なぜURLで上書きできるようにするのか？
//   デモ当日、会場のWi-Fiが落ちたときに mock へ退避したくなる。
//   でも .env を書き換えて npm run deploy し直すには「ネットワークが要る」ので詰む。
//   URLに ?backend=mock を付けるだけで切り替われば、その場で助かる。
//   → 事前に ?backend=mock 付きのURLをブックマークしておくこと。
//
// 使えるクエリ:
//   ?backend=mock … モック（外部通信ゼロ）へ退避する
//   ?backend=aws  … AWSを使う
//   ?sync=1       … 分析結果を待ってから返事をする方式に切り替える
//   ?debug=1      … 手入力の欄を出す（マイクが使えないときの保険）

export type BackendMode = 'mock' | 'aws'

const params = new URLSearchParams(window.location.search)

// URLで指定された値は localStorage に覚えておく。
// こうしないと、PWAを開き直したり画面を再読み込みしたときに設定が消えてしまう。
function readOverride(key: string): string | null {
  const fromUrl = params.get(key)
  if (fromUrl !== null) {
    window.localStorage.setItem(`hp.${key}`, fromUrl)
    return fromUrl
  }
  return window.localStorage.getItem(`hp.${key}`)
}

// .env で指定された既定値。
const envMode = (import.meta.env.VITE_BACKEND_MODE ?? 'mock') as BackendMode
const lambdaUrl = (import.meta.env.VITE_LAMBDA_URL ?? '').trim()

// URLの指定があればそれを優先。
const requested = (readOverride('backend') as BackendMode | null) ?? envMode

// ★事故防止★
// aws を指定されていても、Lambda のURLが設定されていなければ mock で動かす。
// （URLの記入漏れに気づかないまま本番で真っ白、という事故を防ぐため）
export const backendMode: BackendMode = requested === 'aws' && lambdaUrl.length > 0 ? 'aws' : 'mock'

export const config = {
  backendMode,
  lambdaUrl,

  // Lambda と合わせる合言葉。いたずらリクエストを弾くためのもの。
  // ※ビルド成果物に埋め込まれて公開されるので、秘密情報ではありません。
  appKey: import.meta.env.VITE_APP_KEY ?? '',

  // 見守り対象のご本人のID。今回のデモは1名固定。
  userId: import.meta.env.VITE_USER_ID ?? 'elder-001',

  // 会話の分析結果を「待ってから返事する」かどうか。
  //   false（既定）… 先に返事をして、分析結果は1〜2秒後に画面へ反映する。
  //                   会話のテンポが落ちず、クラウドが落ちても会話は続く。
  //   true          … 分析結果を待ってから返事をする。回線が速い会場向け。
  // Day5に実機で往復時間を測ってから決める。
  analysisSync:
    readOverride('sync') === '1' || (import.meta.env.VITE_ANALYSIS_SYNC ?? 'false') === 'true',

  // 分析をあきらめるまでの時間（ミリ秒）。ここを過ぎても会話は止めない。
  timeoutMs: Number(import.meta.env.VITE_ANALYSIS_TIMEOUT_MS ?? 5000),

  // カメラを使うかどうか。カメラの無いPCで開発するときは .env で off にする。
  cameraEnabled: (import.meta.env.VITE_CAMERA ?? 'on') !== 'off',

  // 手入力の欄を出すか（マイクが使えないときの保険）。
  debugInput: readOverride('debug') === '1',
} as const
