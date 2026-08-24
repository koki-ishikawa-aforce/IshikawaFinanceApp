import type { NextConfig } from 'next'

// PR プレビュー配信では GitHub Pages のサブパス(/<リポジトリ名>/pr-<番号>/)配下に
// 置かれるため、ビルド時にベースパスを差し込めるようにする。未設定(通常のビルド・
// ローカル開発・VRT)では空文字となり、経路もアセット URL も従来どおり変わらない。
// 運用: docs/automation/pr-preview.md
const basePath = process.env['NEXT_PUBLIC_BASE_PATH'] ?? ''

const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  ...(basePath === '' ? {} : { basePath }),
  // NEXT_PUBLIC_MOCK をビルド時リテラルとして固定し、未設定時は空文字に畳み込む。
  // これにより api-client の `MOCK_ENABLED` が定数 false となり、モック分岐と
  // 動的 import される src/mocks/* チャンクが通常ビルドからデッドコード除去される。
  env: {
    NEXT_PUBLIC_MOCK: process.env['NEXT_PUBLIC_MOCK'] ?? '',
    // 画面が「今」として扱う日時の固定値(モック起動モードでのみ効く。src/lib/now.ts)。
    // NEXT_PUBLIC_MOCK と同じ理由で、未設定時は空文字に畳み込んで通常ビルドから
    // 分岐ごと除去する。
    NEXT_PUBLIC_MOCK_NOW: process.env['NEXT_PUBLIC_MOCK_NOW'] ?? '',
  },
}

export default config
