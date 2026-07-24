import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // NEXT_PUBLIC_MOCK をビルド時リテラルとして固定し、未設定時は空文字に畳み込む。
  // これにより api-client の `MOCK_ENABLED` が定数 false となり、モック分岐と
  // 動的 import される src/mocks/* チャンクが通常ビルドからデッドコード除去される。
  env: {
    NEXT_PUBLIC_MOCK: process.env['NEXT_PUBLIC_MOCK'] ?? '',
  },
}

export default config
