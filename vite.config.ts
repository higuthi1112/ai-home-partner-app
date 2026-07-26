import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages（プロジェクトページ）の配信先に合わせた base パス。
// 公開URLが https://<ユーザー名>.github.io/ai-home-partner-app/ になる想定。
// リポジトリ名を変えたら、ここも合わせて変更する。
const REPO_NAME = 'ai-home-partner-app'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // 開発中(dev)は '/'、本番ビルド(build)だけ '/ai-home-partner-app/' にする。
  // こうすると npm run dev は localhost:5173/ でそのまま開ける。
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'AIホームパートナー アバター会話デモ',
        short_name: 'ホームパートナー',
        description: '高齢者見守り向け 常時待機アバターの音声会話デモ（ローカル完結・外部通信なし）',
        lang: 'ja',
        display: 'standalone',
        background_color: '#14213d',
        theme_color: '#14213d',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
}))
