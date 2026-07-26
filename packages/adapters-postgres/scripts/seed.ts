/**
 * DB seed の CLI エントリ
 *
 * 既定は規定マスタのみ（本番でも安全に実行できる内容）。開発用のダミーデータは
 * --with-dev-fixtures を明示したときだけ投入する。既定を安全側に置くことで、
 * 本番 DB に対して誤って実行してもテスト用の取引が入らない（#322）。
 *
 *   pnpm --filter @warimaru/adapters-postgres db:seed       規定マスタのみ
 *   pnpm --filter @warimaru/adapters-postgres db:seed:dev   規定マスタ + 開発フィクスチャ
 *
 * 冪等: どちらのモードも upsert のみで、2 回連続実行しても結果は同じ。
 */
import 'dotenv/config'
import { createDbConnection } from '../src/client'
import { isProductionNodeEnv } from '../src/nodeEnv'
import { seedDefaultMasters } from './seed/masters'
import { seedDevFixtures } from './seed/dev-fixtures'

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in .env or environment.')
  process.exit(1)
}

const isProduction = isProductionNodeEnv(process.env['NODE_ENV'])

const withDevFixtures = process.argv.includes('--with-dev-fixtures')

// 本番へ開発フィクスチャを投入する事故を防ぐ（composition-root のモック拒否と同じ方針）
if (withDevFixtures && isProduction) {
  console.error(
    'Refusing to seed development fixtures with NODE_ENV=production. ' +
      'Run without --with-dev-fixtures to seed the default masters only.',
  )
  process.exit(1)
}

// 接続先が Neon なら neon-http、ローカルの素の PostgreSQL なら node-postgres (#323)
// node-postgres を選んだときだけ pg を読み込むため、接続ファクトリは非同期 (#349)
const connection = await createDbConnection({
  databaseUrl: DATABASE_URL,
  isProduction,
  driverOverride: process.env['DATABASE_DRIVER'],
})
const db = connection.db

async function seed(): Promise<void> {
  console.log(
    withDevFixtures
      ? 'Seed mode: default masters + development fixtures'
      : 'Seed mode: default masters only',
  )
  await seedDefaultMasters(db)
  if (withDevFixtures) {
    await seedDevFixtures(db)
  }
  console.log('Seed complete!')
}

// node-postgres はプールを保持するため、閉じないとスクリプトが終了しない
try {
  await seed()
} catch (err) {
  console.error('Seed failed:', err)
  process.exitCode = 1
} finally {
  // close の失敗で seed 本体の失敗理由が unhandled rejection に埋もれないようにする
  await connection.close().catch(e => console.error('Failed to close DB connection:', e))
}
