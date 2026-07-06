/**
 * 統合テスト用 DB ヘルパ
 *
 * DATABASE_URL の素の PostgreSQL に pg ドライバで接続する
 * （本番は @neondatabase/serverless だが、Neon 固有機能を使わないため
 *  素の PostgreSQL で等価に検証できる — M-B spec §6.2）。
 */
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getTableName, is, sql } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import type { Db } from '../../src/client'
import * as schema from '../../src/schema'

/** 統合テストが TRUNCATE してよい DB 名（誤って実 DB を指した事故を防ぐ） */
const TEST_DATABASE_NAME = 'warimaru_test'

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (url === undefined || url === '') {
    throw new Error(
      '統合テストには DATABASE_URL が必要です。' +
        'ローカルでは `docker compose up -d db` を起動し、' +
        'DATABASE_URL=postgres://postgres:postgres@localhost:5432/warimaru_test を設定してください。',
    )
  }
  assertResettableDatabase(url)
  return url
}

/**
 * 統合テストは beforeEach で全テーブルを TRUNCATE するため、
 * DB 名が warimaru_test 以外（例: 実 Neon の URL がシェルに残っていた）なら拒否する。
 * 意図的に別名 DB を使う場合のみ ALLOW_DB_RESET=1 で明示的に解除できる。
 */
function assertResettableDatabase(url: string): void {
  const dbName = new URL(url).pathname.replace(/^\//, '')
  if (dbName !== TEST_DATABASE_NAME && process.env.ALLOW_DB_RESET !== '1') {
    throw new Error(
      `統合テストは全テーブルを TRUNCATE するため、DB 名 ${TEST_DATABASE_NAME} 以外を拒否します` +
        `（DATABASE_URL の DB 名: ${dbName}）。` +
        'この DB を消してよい場合のみ ALLOW_DB_RESET=1 を設定してください。',
    )
  }
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

/**
 * 全テーブルを空にする（FK があるため CASCADE、各テストの beforeEach で呼ぶ）。
 * 対象はスキーマ定義から導出する — 第 2 波でテーブルを足してもここは無変更。
 */
export async function resetDb(db: Db): Promise<void> {
  const tables = Object.values(schema).filter(t => is(t, PgTable))
  const tableList = sql.join(
    tables.map(t => sql.identifier(getTableName(t))),
    sql.raw(', '),
  )
  await db.execute(sql`TRUNCATE ${tableList} CASCADE`)
}
