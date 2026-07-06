/**
 * 統合テスト用 DB ヘルパ
 *
 * DATABASE_URL の素の PostgreSQL に pg ドライバで接続する
 * （本番は @neondatabase/serverless だが、Neon 固有機能を使わないため
 *  素の PostgreSQL で等価に検証できる — M-B spec §6.2）。
 */
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { Db } from '../../src/client'
import * as schema from '../../src/schema'

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (url === undefined || url === '') {
    throw new Error(
      '統合テストには DATABASE_URL が必要です。' +
        'ローカルでは `docker compose up -d db` を起動し、' +
        'DATABASE_URL=postgres://postgres:postgres@localhost:5432/warimaru_test を設定してください。',
    )
  }
  return url
}

export interface TestDb {
  db: Db
  pool: Pool
  close: () => Promise<void>
}

export function createTestDb(): TestDb {
  const pool = new Pool({ connectionString: requireDatabaseUrl() })
  const db = drizzle(pool, { schema })
  return { db, pool, close: () => pool.end() }
}

/** 全テーブルを空にする（FK があるため CASCADE、各テストの beforeEach で呼ぶ） */
export async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE transactions, monthly_reports, mitsui_sumitomo_unpaids, accounts CASCADE`,
  )
}
