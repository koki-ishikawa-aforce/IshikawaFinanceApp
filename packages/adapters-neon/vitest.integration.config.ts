import { defineConfig } from 'vitest/config'

/**
 * 統合テスト（実 PostgreSQL 必須、DATABASE_URL を要求）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §6.2
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/globalSetup.ts'],
    // 共有 DB のため直列実行（TRUNCATE ベースのリセットと競合しないように）
    fileParallelism: false,
  },
})
