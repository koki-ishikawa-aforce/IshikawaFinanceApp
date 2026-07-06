/**
 * 統合テストの globalSetup: マイグレーションを 1 回適用する
 *
 * dotenv はテストワーカーと別プロセスで動くためここでも読む（setup.ts と対）。
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { requireDatabaseUrl } from '../helpers/db'

export default async function setup(): Promise<void> {
  const pool = new Pool({ connectionString: requireDatabaseUrl() })
  try {
    const migrationsFolder = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../drizzle',
    )
    await migrate(drizzle(pool), { migrationsFolder })
  } finally {
    await pool.end()
  }
}
