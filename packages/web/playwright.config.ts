import { defineConfig, devices } from '@playwright/test'
import { MOCK_NOW, MOCK_TIMEZONE } from './src/mocks/clock'

/**
 * E2E / スクリーンショット用の Playwright 設定。
 *
 * モック起動モード（NEXT_PUBLIC_MOCK=1）の `next dev` を webServer として立ち上げ、
 * LIFF 認証・実 API なしで画面を検証する。ブラウザは実行環境にプリインストール済みの
 * Chromium（PLAYWRIGHT_BROWSERS_PATH）を利用する。
 */
const PORT = 3100

/*
 * 検証中に画面が「今」として扱う日時と時間帯は `src/mocks/clock.ts` から取る（#506）。
 *
 * 月名・日付・「表示中の月が当月か」で見た目が変わる画面（ホーム・取引一覧・レポート・
 * 取込・経費精算・残高）は、実時刻のままだと月が替わるたび基準画像とずれていく。
 * ずれは `maxDiffPixelRatio` の許容量に吸収されて緑のまま通るため、その許容量のぶんだけ
 * 日付と関係のない崩れも一緒に見逃せる。日時を固定してずれ自体を無くす。
 *
 * 値を fixture の隣に置いてあるのは、fixture が想定している「今」とこの固定値がずれると、
 * 画面の見出しと中身が食い違ったものを基準画像として固定してしまうため。
 *
 * 時間帯はブラウザと `next dev`（SSR）の双方へ同じ値を渡す（片方だけだと初期 HTML と
 * ハイドレーション後で日付がずれる）。
 */

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
    timezoneId: MOCK_TIMEZONE,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `next dev --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    // NEXT_PUBLIC_BASE_PATH は PR プレビュー配信でのみ使う。端末の環境変数を
    // 引き継ぐと baseURL とずれて VRT が全滅するため、ここで空に固定する。
    env: {
      NEXT_PUBLIC_MOCK: '1',
      NEXT_PUBLIC_BASE_PATH: '',
      NEXT_PUBLIC_MOCK_NOW: MOCK_NOW,
      TZ: MOCK_TIMEZONE,
    },
  },
})
