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
      '../packages/adapters-postgres/drizzle',
    )
    await migrate(drizzle(pool), { migrationsFolder })

    await seedTestUsers(pool)
    await seedDefaultMasters(pool)
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

  await pool.query(`DELETE FROM app_users WHERE role IN ('honey', 'darling')`)

  for (const u of users) {
    await pool.query(
      `INSERT INTO app_users (user_id, role, kind, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, kind = EXCLUDED.kind, payload = EXCLUDED.payload`,
      [u.userId, u.role, u.payload.kind, JSON.stringify(u.payload)],
    )
  }
}

/**
 * 規定カテゴリ / 規定経費種別を投入する。
 * 分類シナリオ（AT-202）は規定マスタの ID を直接指定するため、テスト側で ID を固定できる
 * ようにここで seed する。世帯共有スコープ（owner_user_id = NULL）で入れる。
 * 取込シナリオ（AT-301〜303）は必要なカテゴリを API で自ら作るため、この seed に依存しない。
 */
async function seedDefaultMasters(pool: import('pg').Pool): Promise<void> {
  const categories = [
    {
      id: '01JAAAAAAAAAAAAAAAAAAAAAA1',
      name: '住居光熱通信',
      defaultKind: 'housing_utilities_communication',
    },
    { id: '01JAAAAAAAAAAAAAAAAAAAAAA2', name: '食費', defaultKind: 'food' },
    { id: '01JAAAAAAAAAAAAAAAAAAAAAA3', name: '娯楽', defaultKind: 'entertainment' },
    { id: '01JAAAAAAAAAAAAAAAAAAAAAA4', name: 'その他', defaultKind: 'other' },
  ] as const

  for (const c of categories) {
    await pool.query(
      `INSERT INTO category_masters (category_id, kind, name, owner_user_id, payload)
       VALUES ($1, 'default', $2, NULL, $3)
       ON CONFLICT DO NOTHING`,
      [
        c.id,
        c.name,
        JSON.stringify({
          kind: 'default',
          categoryId: c.id,
          name: c.name,
          scope: { kind: 'household_shared' },
          defaultKind: c.defaultKind,
        }),
      ],
    )
  }

  const expenseTypes = [
    { id: '01JEEEEEEEEEEEEEEEEEEEEEE1', name: 'ジム', defaultKind: 'gym' },
    { id: '01JEEEEEEEEEEEEEEEEEEEEEE2', name: '書籍・新聞', defaultKind: 'books_newspaper' },
    { id: '01JEEEEEEEEEEEEEEEEEEEEEE3', name: 'AI利用', defaultKind: 'ai_usage' },
    { id: '01JEEEEEEEEEEEEEEEEEEEEEE4', name: '交通費', defaultKind: 'transportation' },
    { id: '01JEEEEEEEEEEEEEEEEEEEEEE5', name: 'その他経費', defaultKind: 'other_expense' },
  ] as const

  for (const e of expenseTypes) {
    await pool.query(
      `INSERT INTO expense_type_masters (expense_type_id, kind, name, owner_user_id, payload)
       VALUES ($1, 'default', $2, NULL, $3)
       ON CONFLICT DO NOTHING`,
      [
        e.id,
        e.name,
        JSON.stringify({
          kind: 'default',
          expenseTypeId: e.id,
          name: e.name,
          scope: { kind: 'household_shared' },
          defaultKind: e.defaultKind,
        }),
      ],
    )
  }
}
