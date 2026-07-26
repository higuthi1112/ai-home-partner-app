# CLAUDE.md — プロジェクト引き継ぎメモ

> このファイルは Claude Code（VSCode等）がプロジェクトを開くと自動で読み込む引き継ぎ用ドキュメントです。
> 作業を引き継ぐ際は、まずここを読んでから着手してください。
> より詳しい仕様は [仕様書.md](仕様書.md)、起動・配信手順は [README.md](README.md)、元の要件は
> [claude-code_avatar-demo_指示書_v1.1.md](claude-code_avatar-demo_指示書_v1.1.md) を参照。

---

## 1. これは何か（概要）

高齢者見守りPWA「AIホームパートナー」の中核体験＝**常時待機アバターとの音声会話**を、
コンテストのライブデモ用に先行実装した**簡易デモ**。

- アバター（ネオン線画の猫の顔）に話しかけると、音声で日本語の返事が返る（会話が往復する）。
- 会話そのものは**ブラウザ内でローカル完結**（Web Speech API）。ここは今後も変えない。
- 2026-07-26 より**クラウド連携フェーズ**に入った。会話テキストと笑顔の静止画を
  Lambda 経由で分析し、体調の変化を家族の Gmail へ通知する。詳細は §2 と §12。

## 2. 絶対に守る制約（最重要・ユーザー明示）

> **2026-07-26 改訂。** クラウド連携フェーズ開始に伴い、旧「外部通信一切禁止・モック実装のみ」
> から差し替えた。**旧ルールはもう無効**なので、`fetch` の追加を拒否しないこと。

以下は破ってはいけない。疑わしくなったら**実装を止めて必ず確認**すること。

- ❌ **フロントエンドに AWS SDK を import しない**（`@aws-sdk`, `aws-amplify` 等）。
     AWS の API を呼ぶのは Lambda 側の仕事。フロントは Lambda を `fetch` するだけ。
- ❌ **フロントエンドに認証情報（アクセスキー等）を書かない**。
     **`VITE_*` の値はビルド成果物に埋め込まれ、GitHub Pages 上で誰でも読める。**
     `VITE_LAMBDA_URL` も `VITE_APP_KEY` も秘密ではない。**すべて「公開情報」として扱うこと。**
- ✅ **フロントから叩いてよい外部URLは Lambda Function URL（`VITE_LAMBDA_URL`）だけ**。
     他の `https://` を `fetch` しない。
- ✅ **AWS呼び出しは必ず `src/services/` 層を経由する**。components / hooks から直接叩かない。
     **`fetch` を書いてよいファイルは `src/services/apiClient.ts` の1つだけ。**
- ✅ **`VITE_BACKEND_MODE=mock` のとき、外部通信ゼロで全機能が動くこと**（家族ダッシュボードも
     モックデータで表示できること）。これはデモ当日の退避経路。**この性質を壊す変更は禁止。**
- ✅ URL に `?backend=mock` を付けたら、ビルドし直さずモックへ退避できること。
     （会場でWi-Fiが落ちたとき、`.env` を書き換えて再デプロイするには通信が要る＝詰む）
- ✅ AWS は**無料枠の範囲内**。AWS Budgets のアラートが設定済みであることを前提とする。
- 音声は同梱ファイル or ブラウザ内蔵のみ（Polly 等をランタイムで呼ばない）。

> 検査観点: `src/` を `grep` して、`fetch(` が `services/apiClient.ts` 以外に無いこと。
> `@aws-sdk` / `aws-amplify` の import がゼロであること。変更後も同様であること。

## 2.5 「元気度」の表現ルール（薬機法・倫理上の必須事項）

カメラの笑顔と会話の感情から算出する「元気度」は、**観察の目安**であって病気の診断ではない。
**うつ病の判定ではない。** これは法令・倫理の要請であり、表現の好みの問題ではない。

- **使ってはいけない語**（画面・メール・ドキュメント・発表資料すべて）:
  うつ / 認知症 / 診断 / 疑い / 異常 / 判定（病名の文脈）/ リスク（病名の文脈）
- **使ってよい表現**:
  「最近、笑顔が少ないようです」「いつもより元気度が低めです」
  「お時間のあるときにお電話してみませんか」
- **比較対象は必ずご本人の平常値**（直近14日の本人平均）。他人の平均や一般値と比べない。
  DynamoDB の Query が `userId` 固定であることが、この制約の実装的な担保になっている。
- **すべての通知メールに次の一文を必ず入れる**:
  「※これは会話と表情から算出した目安であり、医学的な診断ではありません。」
- 平常値のサンプルが**3日未満のときは低下判定を行わない**（誤検知防止）。

## 3. コーディング方針

- **初心者チームが読める前提**。コメントは**日本語**で丁寧に。
- 見た目（アバター等）はロジックと分離（デザインを後で差し替えやすく）。
- 状態管理は React の `useState` のみ（外部ライブラリ・useReducerは使わない方針）。
- 大きな方向転換や不明点は、勝手に決めず先に質問する。

## 4. 技術スタック

- React 19 + Vite + TypeScript、素のCSS（Tailwind不使用）。
- 音声: ブラウザ標準 Web Speech API（`SpeechRecognition` / `speechSynthesis`, `ja-JP`）。
- カメラ: ブラウザ標準 `getUserMedia` → canvas → JPEG(base64)。ライブラリ不使用。
- PWA: `vite-plugin-pwa`（`generateSW`）。配信想定: GitHub Pages。
- パッケージ管理: npm。**ランタイム依存は React だけ**（ルーター・状態管理・チャートを追加しない）。
- クラウド: Lambda Function URL / Rekognition / Comprehend / DynamoDB / SNS(Email)。
  すべて **ap-northeast-1（東京）** に統一。フロントは Lambda を `fetch` するだけ。

## 5. 実行・確認方法

```bash
npm install        # 初回のみ
npm run dev        # 開発サーバー → Chrome で http://localhost:5173
npm run build      # 本番ビルド（tsc -b && vite build）※型チェック込み
npm run deploy     # build して gh-pages ブランチへ公開
```

- **デモ・確認は必ず Chrome**（音声認識が最も安定。Safariは不安定）。
- マイク許可が必要。localhost または HTTPS でのみ音声が動く。
- 型だけ確認: `npx tsc --noEmit -p tsconfig.app.json`

## 6. 設計・ディレクトリ構成

```
src/
  components/
    Avatar/          ネオン猫の顔SVG。state(idle/listening/speaking)で表情切替。発光はCSS drop-shadow
    Captions/        字幕（アバター発話＋聞き取り結果）
    Controls/        「話す」ボタン
    StatusBadges/    気分スコア／通知オフバッジ／家族トースト／緊急バナー／モード表示
    SettingsMenu/    右上ハンバーガー→設定パネル（項目は「通知」のみ・現状は非機能）
    Camera/          カメラの小さなプレビュー（常時ON。「今カメラが動いている」を見せる意味もある）
    FamilyDashboard/ 家族用の閲覧画面（#family で表示。読み取り専用・認証なし）
  hooks/
    useSpeechRecognition.ts  音声認識ラッパー（start/stopを命令的に呼ぶ）
    useSpeechSynthesis.ts    音声合成ラッパー（方針A: MP3再生 → 無ければ方針B: 自然寄り調整）
    useCamera.ts             カメラ。start/capture/stop。captureは640x480のJPEG(base64)を返す
    useConversation.ts       会話の司令塔。上3フックとservices/matchingを統合しターンテイキング制御
  services/
    config.ts                環境変数と URL クエリ(?backend=mock 等)の読み取りを集約
    apiClient.ts             ★fetch を書いてよい唯一のファイル。Lambda Function URL を叩く
    analysisService.ts       インターフェース定義＋モック実装（元気度・履歴）
    awsAnalysisService.ts    AWS実装（apiClient経由でLambdaを呼ぶ）
    notificationService.ts   インターフェース定義＋モック実装（画面表示のみ）
    awsNotificationService.ts AWS実装（Lambda経由でSNS→Gmail）
    index.ts                 VITE_BACKEND_MODE / ?backend で mock/aws を実際に分岐
  data/
    conversation.json        会話ツリー（★非エンジニアが編集。ここが会話内容の唯一の情報源）
  assets/audio/
    manifest.ts              セリフ→MP3の対応表（現状空。方針Aの器）
  matching.ts                応答判定の純粋関数（将来LLM差し替え用に独立）
  types.ts                   共有型（ConversationData, Mood, AvatarState, AlertLevel 等）
  App.tsx                    薄い配線層（useConversationの戻り値を各componentへ渡すだけ）
  main.tsx                   ルート描画。#family なら FamilyDashboard、それ以外は App
                             （StrictModeは音声二重発火回避のため意図的に外している）

aws/                         ★フロントのビルドには含まれない（tsconfigのincludeはsrcのみ）
  index.mjs                  Lambda本体。AWSコンソールに貼るだけで動く単一ファイル
  iam-policy.json            Lambda実行ロールに貼るインラインポリシー
  test-events/               コンソールの「テスト」用イベント5本
  AWS構築手順書.md            AWS担当向け。コンソールの画面遷移レベルの手順
```

**データフロー**:
`UI/components → hooks(useConversation) → services/ → apiClient → Lambda Function URL → AWS各種`
UIやcomponentから直接AWSを呼ばず、必ず `services/` 層を経由する設計。

## 7. 会話ロジックの仕様

判定順（[matching.ts](src/matching.ts) の `matchInput`）:

1. **controlPhrases**（制御フレーズ）を最優先で部分一致判定 → 専用応答＋画面フィードバック。
2. **intents**（通常意図）→ 応答候補からランダム＋気分スコア更新。
3. 当たらなければ **fallback** からランダム。
4. 応答後は自動で聞き取りに戻る（ターンテイキング）。

> **2026-07-26 改訂。** 発話ごとに判定して即通報する方式をやめ、**問診方式**に変えた。
> 「気分が悪い」の一言で家族へ通報するのは見守りアプリとして不適切だったため。

### 会話には2つのモードがある

**【問診モード】朝晩2回・ここだけクラウドを使う**
`useInterview.ts` が進行を担当する。質問を順にたずね、**回答は端末内に貯めるだけ**。
最後の質問で笑顔を撮り、**全部そろってから1回だけ** `analyzeInterview` でクラウドへ送る。
Bedrock の Claude が全回答＋笑顔スコア＋本人の平常値を読んで総合判断し、
**心配なときだけ** SNS → 家族の Gmail へ通知する。

台本（質問文・挨拶・締めのことば）は `conversation.json` の `interview` にある。
起動は設定画面の時刻、または「いま問診を始める」ボタン（**デモ当日の生命線**）。

**【雑談モード】問診以外の時間・端末内で完結**
`matchInput()` でキーワード判定 → 当たれば即答（遅延ゼロ・ネット不要）。
外れたら `fallback`。将来ここが Gemini / Bedrock の雑談に差し替わる（`CHAT_PROVIDER`）。

### 制御フレーズの action と動作

| action | 動作 |
|---|---|
| `emergency`（例:「助けて」） | **★問診中でも即座に中断して通知★**（安全側。倒れている人に「では次の質問です」と続けない） |
| `suppressNotifications`（例:「今日は病院」） | その日の WARNING を抑制（**EMERGENCY は抑制しない**） |
| `notifyFamily`（例:「気分が悪い」） | 雑談中のみ即時通知。問診中は「回答」として扱い、最後にまとめて判断する |
| `smileCheck` | 問診の中で行うため、単体では案内するだけ |

- キーワード等の実データは [src/data/conversation.json](src/data/conversation.json) が唯一の情報源
  （コードにハードコードしない。編集だけで会話を変えられる状態を維持する）。
- **元気度（aws時）**: Lambda が算出した**絶対値**を受け取る（フロント側で加算しない）。
  こうしておくと、分析結果の到着順が前後してもスコアが壊れない。
- **元気度（mock時）は今もキーワードのif文**（`analysisService.ts` の `NEGATIVE_WORDS`）。
  これはAWS無しで画面を作るための**仮実装**であり、AIではない。
  `?backend=mock` で動かしているときは「AIが判定しています」と説明できないことに注意。

## 8. 進捗

### 完了（動作確認済み・安定）
- [x] フェーズA〜F相当（土台／挨拶／聞く／会話／制御フレーズ＆気分スコア／PWA・README）を実装。
- [x] v1.1 の音声自然化（方針B）を実装。方針A（MP3同梱）は器のみ用意。
- [x] 画面デザイン刷新：紺→明るいドット背景、緑の円→**ネオン猫SVG（3状態）**、右上ハンバーガー→設定パネル。
- [x] 設定パネルは項目「通知」のみ（押せるが何もしない、後日実装のプレースホルダ）。

### クラウド連携フェーズ（2026-07-26 開始・提出 2026-08-05）
実装計画の全文は `C:\Users\YUUSU\.claude\plans\md-distributed-music.md`。

**完了**
- [x] CLAUDE.md §2 改訂（外部通信禁止を撤廃・§2.5 表現ルール追加）
- [x] `config.ts` / `apiClient.ts` / サービス層拡張 / `useConversation` 非同期化
- [x] 手入力フォールバック（`?debug=1`）
- [x] 画面の重なり修正（3帯構成・`z-index` 段階化）
- [x] **問診方式への作り替え**（`useInterview` / 結果パネル / 設定画面 / SOS即時中断）
- [x] **Lambda 全面書き換え**（`analyzeInterview` = Rekognition + Bedrock総合判断、
      `chat` = Gemini/Bedrock切替、日次カウンター）＋ AWS担当への依頼文

**残り**
- [ ] **Git init → GitHub → `npm run deploy` → 実URL確定**（ユーザー作業・**全体の律速**）
- [ ] AWS担当: Budgets → **Bedrock利用申請** → DynamoDB → SNS → Lambda → CORS
- [ ] `useCamera` / `CameraPreview`（笑顔撮影。今は「撮れなかった」で素通り）
- [ ] 初結合（**CORSデーとして丸一日確保**）
- [ ] 家族ダッシュボード + `#family` ハッシュ切替
- [ ] 時刻による問診の自動起動を配線（`watchSchedule.ts` は作成済み・未接続）
- [ ] 実機デー / 表現ルール総点検 / ドキュメント修正
- [ ] 通しリハーサル + **90秒バックアップ動画を収録**

## 9. 既知の注意点（ハマりどころ）

### 既存（触るときに壊さない）
- **音声合成のGC対策**: Chromeは発話中の `SpeechSynthesisUtterance` を保持しないと途中でGCされ
  `onend` が発火しない。`useSpeechSynthesis.ts` で `utteranceRef` に保持＋保険タイマーで対策済み。
  ここを触るときは壊さないこと。
- **認識と合成の排他**: 発話中は聞き取りを止める。`speak()`前に`stop()`する流れを維持。
- **StrictMode不使用**: `main.tsx` で意図的に外している（開発時の二重発話防止）。戻さない。
- **`startListening` に `useMemo` 最適化を足さない**。現状すでに毎描画で作り直され、
  `startListeningRef.current` を毎描画で再代入することで最新版を保っている。
  「無駄な再生成だ」と思って memo 化すると**古い閉包を掴んで会話が壊れる**。
- **ブラウザ差**: 音声認識はChrome前提。Web Speech APIは非対応/権限拒否時に画面上部で案内。

### クラウド連携で新たに増えたもの
- **非同期分析には連番ガードが要る**: ターン1の遅い結果がターン2の速い結果の後に届くと
  スコアが巻き戻る。`analysisSeqRef` で採番し、古い結果は捨てる。**必ず踏むバグ。**
- **`moodRef` が必要な理由**: `recognition.start({ onResult })` のコールバックは
  *傾聴開始時点の*閉包を掴むため、`mood` state が古い。ref に写して常に最新を読む。
- **CORS の `AllowOrigins` はオリジンのみ**。`https://xxx.github.io/ai-home-partner-app/` と
  パスまで書くと**必ず失敗する**。正しくは `https://xxx.github.io`。最も踏みやすい罠。
- **SNS の `Subject` は ASCII のみ・100文字未満**。日本語件名は拒否される。日本語は本文へ。
- **`Content-Type: text/plain` を使う**理由: `application/json` だと CORS プリフライト
  (`OPTIONS`) が飛んで往復が倍になる。Lambda 側は content-type を見ずに `JSON.parse` する。
- **Wi-Fiが落ちると音声認識ごと死ぬ**: Chromeの音声認識は内部的に音声をGoogleへ送っている
  （ブラウザ標準の挙動で無料。自前のfetchではない）。つまり `?backend=mock` に退避しても
  会話は復活しない。→ **手入力フォールバック**（`?debug=1`）が当日の最後の砦。
- **画像を CloudWatch Logs に出力しない**。ログに残ると「画像は保存しません」が嘘になる。
  `console.log` してよいのは `imageBase64.length` だけ。

## 10. 今後やること（TODO）

### 提出（8/5）までにやること
→ §8 のチェックリストと実装計画 `C:\Users\YUUSU\.claude\plans\md-distributed-music.md` を参照。

### 余力があれば（切ってよい順に並んでいる）
- [ ] 通知設定パネル（受信最低レベル／サイレント時間帯／ダイジェスト）。localStorage の3トグルを
      `notify` のボディに載せ、Lambda が受信最低レベルだけ尊重する簡易版でよい。
- [ ] 無応答リマインド演出（アプリを開いている間に N 秒発話が無ければ声かけ→さらに N 秒で emergency）。
      **AWSサービスを1つも増やさず**エスカレーションの物語を見せられる。約15行。
- [ ] 本人による当日データ削除（`deleteToday`）。仕様書の「自己コントロール権」の実装。
- [ ] アバターSVGをデザイン担当のFigmaカンプへ差し替え（`components/Avatar/` のみ差し替えで済む設計）。
- [ ] 音声MP3の同梱（方針A）: `assets/audio/manifest.ts` に登録。再生は同梱ファイルのみ。

### 提出後
- [ ] **コンテスト終了後に Lambda Function URL を削除する**（カレンダーに入れる）。
- [ ] 認証(Cognito)。今は「秘密のURL」方式なので、実運用には必須。
- [ ] EventBridge による起床/就寝のスポット分析と、+15/30/60分の無応答エスカレーション（仕様書§5.2）。
- [ ] 日次ダイジェストメール（EventBridge Scheduler）。
- [ ] 工程が増えたら Step Functions を導入（今は工程が2つしかないので Lambda 単体が最小構成）。
- [ ] アバターのカスタマイズUI、応答バリエーション拡充（`conversation.json` の充実）。

## 11. 未確定・要確認事項

- **GitHub リポジトリ名と公開URL（Day0で確定させる。ここが決まらないと CORS が設定できない）**。
  `vite.config.ts` の `REPO_NAME` と `package.json` の `homepage` を一致させること。
- 事前生成音声（MP3）の作成手段と素材。
- アバターのデザインカンプ（Figma）の提供時期。
- 会場のネットワーク事情（Wi-Fi の有無・速度）。テザリングの予備回線を必ず用意する。

## 12. AWS 資源一覧（構築後にここへ記入する）

次のセッションが探し回らずに済むよう、**AWS担当が構築したら必ずここを埋める**こと。

| 項目 | 値 |
|---|---|
| リージョン | `ap-northeast-1`（東京）※全リソース統一 |
| DynamoDB テーブル | `HomePartnerEvents`（PK=`userId` / SK=`sk` / TTL=`expiresAt`） |
| SNS トピック | `home-partner-family-alerts` / ARN: `（記入）` |
| Lambda 関数名 | `（記入）` / Node.js 22.x / 512MB / タイムアウト10秒 / 予約同時実行2 |
| Function URL | `（記入）` ← `.env` の `VITE_LAMBDA_URL` に入れる |
| Lambda 実行ロール | `（記入）` |
| GitHub Pages URL | `（記入）` ← CORS の `AllowOrigins` にはオリジンのみ書く |
| AWS Budgets | ¥1 でアラート設定済み？ `（記入）` |

**設計の要点**
- **1テーブル設計**。`sk` のプレフィックスで用途を分ける:
  `EVENT#<ISO8601>`（分析1件）/ `ALERT#<ISO8601>`（通知の発報記録）/
  `SETTING#suppress#<YYYY-MM-DD>`（その日の通知オフ）
- 必要なクエリは3種類だけ。**1リクエストあたり DynamoDB 呼び出しは最大3回。GSI 不要。**
- **画像は保存しない**（S3を使わない）。base64 で Lambda に直送 → Rekognition に渡して即破棄。
- **Transcribe は使わない**。Web Speech API が既に確定テキストを返すため不要。
- **Step Functions は使わない**。工程が Rekognition と Comprehend の2つだけなので Lambda 単体で足りる。
- 元気度 = `0.6 × 最新の笑顔スコア + 0.4 × 当日の会話スコア平均`（重みは Lambda 冒頭の定数）。
- 平常値は**直近14日の本人平均**（今日を除く）。サンプル3日未満なら低下判定をしない。
