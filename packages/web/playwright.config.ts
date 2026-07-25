import { defineConfig, devices } from '@playwright/test'

/**
 * E2E / スクリーンショット用の Playwright 設定。
 *
 * モック起動モード（NEXT_PUBLIC_MOCK=1）の `next dev` を webServer として立ち上げ、
 * LIFF 認証・実 API なしで画面を検証する。ブラウザは実行環境にプリインストール済みの
 * Chromium（PLAYWRIGHT_BROWSERS_PATH）を利用する。
 */
const PORT = 3100

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  timeout: 60_000,
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `next dev --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    // NEXT_PUBLIC_BASE_PATH は PR プレビュー配信でのみ使う。端末の環境変数を
    // 引き継ぐと baseURL とずれて VRT が全滅するため、ここで空に固定する。
    env: { NEXT_PUBLIC_MOCK: '1', NEXT_PUBLIC_BASE_PATH: '' },
  },
})
