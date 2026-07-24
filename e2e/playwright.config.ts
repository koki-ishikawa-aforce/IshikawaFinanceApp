import { defineConfig, devices } from '@playwright/test'

const API_PORT = 3001
const WEB_PORT = 3000
const CI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI,
  timeout: 60_000,
  retries: CI ? 1 : 0,
  reporter: 'list',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @warimaru/api dev',
      port: API_PORT,
      reuseExistingServer: !CI,
      timeout: 30_000,
      env: {
        ...(process.env['DATABASE_URL'] ? { DATABASE_URL: process.env['DATABASE_URL'] } : {}),
        NODE_ENV: 'test',
        PORT: String(API_PORT),
      },
    },
    {
      command: `pnpm --filter @warimaru/web dev --port ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { NEXT_PUBLIC_MOCK: '1' },
    },
  ],
})
