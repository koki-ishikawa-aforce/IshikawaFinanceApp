import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // 画面の日付は端末の時間帯によらず JST で出す(usability 5-4、#639)。実装自体は
    // TZ に依存しないが、CI も手元も JST に固定しておくと JST の日付をそのまま期待値に書ける
    env: { TZ: 'Asia/Tokyo' },
    // vi.stubEnv した環境変数をテストごとに戻す。戻し忘れると、モック起動モードの
    // 分岐(NEXT_PUBLIC_MOCK)を読む後続のテストが別のテストの指定で動く
    unstubEnvs: true,
    setupFiles: ['./src/test/setup.ts'],
    // ユニットテストは src 配下の *.test.* と、ビルド検査スクリプト(scripts/)の *.test.mjs のみ。
    // Playwright の e2e/*.spec.ts は対象外
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/__tests__/**'],
    },
  },
})
