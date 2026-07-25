import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const E2E_HONEY_USER_ID = 'e2e-user-honey'
export const E2E_DARLING_USER_ID = 'e2e-user-darling'

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

    await seedTestUsers(pool)
  } finally {
    await pool.end()
  }
}

async function seedTestUsers(pool: import('pg').Pool): Promise<void> {
  const users = [
    {
      userId: E2E_HONEY_USER_ID,
      role: 'honey',
      payload: {
        kind: 'phase1_completed',
        common: {
          userId: E2E_HONEY_USER_ID,
          role: 'honey',
          firstRegisteredAt: '2026-01-01T00:00:00.000Z',
        },
      },
    },
    {
      userId: E2E_DARLING_USER_ID,
      role: 'darling',
      payload: {
        kind: 'phase1_completed',
        common: {
          userId: E2E_DARLING_USER_ID,
          role: 'darling',
          firstRegisteredAt: '2026-01-01T00:00:00.000Z',
        },
      },
    },
  ]

  for (const u of users) {
    await pool.query(
      `INSERT INTO app_users (user_id, role, kind, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO NOTHING`,
      [u.userId, u.role, u.payload.kind, JSON.stringify(u.payload)],
    )
  }
}
