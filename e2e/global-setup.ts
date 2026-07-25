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
    await seedTestData(pool)
  } finally {
    await pool.end()
  }
}

async function seedTestData(pool: import('pg').Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: tableRows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename != 'drizzle_migrations'`,
    )
    if (tableRows.length > 0) {
      const names = tableRows.map(r => `"${r.tablename}"`).join(', ')
      await client.query(`TRUNCATE ${names} CASCADE`)
    }

    for (const u of [
      { userId: 'U_DARLING_DEV', role: 'darling' },
      { userId: 'U_HONEY_DEV', role: 'honey' },
    ] as const) {
      await client.query(
        `INSERT INTO app_users (user_id, role, kind, payload)
         VALUES ($1, $2, 'operation_started', $3)`,
        [u.userId, u.role, JSON.stringify(makeAppUserPayload(u.userId, u.role))],
      )
    }

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
      await client.query(
        `INSERT INTO category_masters (category_id, kind, name, owner_user_id, payload)
         VALUES ($1, 'default', $2, NULL, $3)`,
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
      { id: '01JEEEEEEEEEEEEEEEEEEEEE1', name: 'ジム', defaultKind: 'gym' },
      { id: '01JEEEEEEEEEEEEEEEEEEEEE2', name: '書籍・新聞', defaultKind: 'books_newspaper' },
      { id: '01JEEEEEEEEEEEEEEEEEEEEE3', name: 'AI利用', defaultKind: 'ai_usage' },
      { id: '01JEEEEEEEEEEEEEEEEEEEEE4', name: '交通費', defaultKind: 'transportation' },
      { id: '01JEEEEEEEEEEEEEEEEEEEEE5', name: 'その他経費', defaultKind: 'other_expense' },
    ] as const
    for (const e of expenseTypes) {
      await client.query(
        `INSERT INTO expense_type_masters (expense_type_id, kind, name, owner_user_id, payload)
         VALUES ($1, 'default', $2, NULL, $3)`,
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

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

function makeAppUserPayload(userId: string, role: 'honey' | 'darling'): unknown {
  const registered = '2026-05-01T00:00:00.000Z'
  return {
    kind: 'operation_started',
    common: { userId, role, firstRegisteredAt: registered },
    phase2CompletedAt: registered,
    gmailTokenRef: { userId, tokenStoreRef: `/warimaru/dev/${role}/gmail-token` },
    initialBalanceRef: {
      smbcAccountId: `ACCT_${role.toUpperCase()}_SMBC`,
      otherSavingsAccountId: `ACCT_${role.toUpperCase()}_SMBC`,
      nisaAccountId: `ACCT_${role.toUpperCase()}_NISA`,
    },
    operationStartedAt: registered,
    lineOperationSettings: {
      friendAdd: { kind: 'added', followWebhookReceivedAt: registered },
      talkRoomJoin: { kind: 'joined', talkRoomId: 'TR_DEV_001', joinWebhookReceivedAt: registered },
      notificationActivation: {
        kind: 'activated',
        talkRoomId: 'TR_DEV_001',
        activatedAt: registered,
      },
    },
  }
}
