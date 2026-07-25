/**
 * DB seed の CLI エントリ
 *
 * 既定は規定マスタのみ（本番でも安全に実行できる内容）。開発用のダミーデータは
 * --with-dev-fixtures を明示したときだけ投入する。既定を安全側に置くことで、
 * 本番 DB に対して誤って実行してもテスト用の取引が入らない（#322）。
 *
 *   pnpm --filter @warimaru/adapters-neon db:seed       規定マスタのみ
 *   pnpm --filter @warimaru/adapters-neon db:seed:dev   規定マスタ + 開発フィクスチャ
 *
 * 冪等: どちらのモードも upsert のみで、2 回連続実行しても結果は同じ。
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '../src/schema'
import { seedDefaultMasters } from './seed/masters'
import { seedDevFixtures } from './seed/dev-fixtures'

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in .env or environment.')
  process.exit(1)
}

const withDevFixtures = process.argv.includes('--with-dev-fixtures')

// 本番へ開発フィクスチャを投入する事故を防ぐ（composition-root のモック拒否と同じ方針）
if (withDevFixtures && process.env['NODE_ENV'] === 'production') {
  console.error(
    'Refusing to seed development fixtures with NODE_ENV=production. ' +
      'Run without --with-dev-fixtures to seed the default masters only.',
  )
  process.exit(1)
}

const NOW = new Date('2026-07-15T03:00:00.000Z')

const client = neon(DATABASE_URL)
const db = drizzle(client, { schema })

async function seed(): Promise<void> {
  console.log(
    withDevFixtures
      ? 'Seed mode: default masters + development fixtures'
      : 'Seed mode: default masters only',
  )
  await seedDefaultMasters(db, NOW)
  if (withDevFixtures) {
    await seedDevFixtures(db, NOW)
  }
  console.log('Seed complete!')
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
