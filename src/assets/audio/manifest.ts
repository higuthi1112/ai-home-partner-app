// 事前生成した「自然な音声ファイル」の対応表（§6.5 方針A）。
//
// セリフの全文（conversation.json に書いた文字列）をキーに、同梱したMP3の
// URL を値として登録する。ここに登録があるセリフは、そのMP3を再生する。
// 登録が無いセリフは、自動的に方針B（Web Speech APIの自然寄り調整）で読み上げる。
//
// ★現状は空。MP3を用意したら、次のように import して登録する:
//
//   import greetingMorning from './greeting_morning.mp3'
//   export const audioManifest: Record<string, string> = {
//     'おはようございます。よく眠れましたか？': greetingMorning,
//   }
//
// MP3の作り方は README を参照（Amazon Polly のニューラル音声などで開発時に一度だけ生成）。
// 重要: 再生するのは同梱したローカルファイルのみ。再生時に外部通信は発生させないこと。

export const audioManifest: Record<string, string> = {}
