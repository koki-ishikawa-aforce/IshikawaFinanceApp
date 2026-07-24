import path from 'node:path'
import { fileURLToPath } from 'node:url'

export default async function globalSetup(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) return

  const { Pool } = await import('pg')
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')

  const pool = new Pool({ connectionString: url })
  try {
    const migrationsFolder = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../packages/adapters-neon/drizzle',
    )
    await migrate(drizzle(pool), { migrationsFolder })
  } finally {
    await pool.end()
  }
}
