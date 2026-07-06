/**
 * Neon 接続ファクトリ
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §2.5
 *
 * 第 1 波の save は全て単文 upsert（INSERT ... ON CONFLICT DO UPDATE）で
 * 原子的に完結するため、HTTP ドライバのみを提供する。
 * interactive transaction を要する複文 save が第 2 波で現れた時点で
 * WebSocket `Pool`（@neondatabase/serverless + drizzle-orm/neon-serverless）の
 * ファクトリを追加する。
 *
 * 注意: neon-http の db では db.transaction を呼ばないこと（実行時に throw する）。
 */
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

/**
 * ドライバ横断の DB 型。
 * 本番 = drizzle-orm/neon-http、統合テスト = drizzle-orm/node-postgres（素の PostgreSQL）。
 * どちらも PgDatabase のサブタイプであり、adapter はこの共通型にのみ依存する。
 * （両ファクトリとも `{ schema }` を渡すこと — 渡さないと TFullSchema が単一化しない）
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export function createNeonHttpDb(databaseUrl: string): Db {
  const client = neon(databaseUrl)
  return drizzle(client, { schema })
}
