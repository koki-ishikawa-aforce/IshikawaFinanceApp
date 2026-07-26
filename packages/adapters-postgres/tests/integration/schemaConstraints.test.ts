/**
 * DDL 忠実性テスト: spec §4 の CHECK / UNIQUE / FK / partial index が
 * 実際に DB レベルで効いていることを raw SQL で検証する
 */
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from './setup'
import { newUlid } from '../../src/newId'

async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } }
    return err.cause?.code ?? err.code
  }
}

function insertTransaction(input: {
  kind: string
  categoryId?: string | null
  expenseClass?: string | null
}): Promise<unknown> {
  return db.execute(
    sql`INSERT INTO transactions
        (transaction_id, owner_user_id, kind, merchant_name, amount, occurred_at, category_id, expense_class, payload)
        VALUES (${newUlid()}, 'U-x', ${input.kind}, 'store', 100, now(),
                ${input.categoryId ?? null}, ${input.expenseClass ?? null}, '{}'::jsonb)`,
  )
}

describe('transactions の CHECK 制約（23514）', () => {
  it('不正な kind を拒否する', async () => {
    expect(await pgErrorCode(insertTransaction({ kind: 'bogus' }))).toBe('23514')
  })

  it('不正な expense_class を拒否する', async () => {
    expect(
      await pgErrorCode(
        insertTransaction({ kind: 'classified', categoryId: newUlid(), expenseClass: 'bogus' }),
      ),
    ).toBe('23514')
  })

  it('昇格カラムの片割れ残存（category_id のみ）を拒否する', async () => {
    expect(await pgErrorCode(insertTransaction({ kind: 'deleted', categoryId: newUlid() }))).toBe(
      '23514',
    )
  })

  it('classified なのに昇格カラムが NULL の行を拒否する', async () => {
    expect(await pgErrorCode(insertTransaction({ kind: 'classified' }))).toBe('23514')
  })

  it('unclassified なのに昇格カラムが揃っている行を拒否する', async () => {
    expect(
      await pgErrorCode(
        insertTransaction({
          kind: 'unclassified',
          categoryId: newUlid(),
          expenseClass: 'household',
        }),
      ),
    ).toBe('23514')
  })
})

describe('monthly_reports の制約', () => {
  function insertReport(month: string): Promise<unknown> {
    return db.execute(
      sql`INSERT INTO monthly_reports (monthly_report_id, target_year_month, kind, payload)
          VALUES (${newUlid()}, ${month}, 'csv_confirmed', '{}'::jsonb)`,
    )
  }

  it('YYYY-MM 形式違反を拒否する（23514）', async () => {
    expect(await pgErrorCode(insertReport('2026-13'))).toBe('23514')
    expect(await pgErrorCode(insertReport('202607'))).toBe('23514')
  })

  it('同一月の重複を拒否する（23505）', async () => {
    await insertReport('2026-07')
    expect(await pgErrorCode(insertReport('2026-07'))).toBe('23505')
  })
})

describe('accounts / mitsui_sumitomo_unpaids の制約', () => {
  function insertAccount(owner: string, kind: string): Promise<unknown> {
    return db.execute(
      sql`INSERT INTO accounts (account_id, owner_user_id, kind, is_active, payload)
          VALUES (${newUlid()}, ${owner}, ${kind}, true, '{}'::jsonb)`,
    )
  }

  it('UNIQUE (owner_user_id, kind) の重複を拒否する（23505）', async () => {
    await insertAccount('U-x', 'smbc_bank')
    expect(await pgErrorCode(insertAccount('U-x', 'smbc_bank'))).toBe('23505')
    // 別ユーザー・別種別は通る
    expect(await pgErrorCode(insertAccount('U-y', 'smbc_bank'))).toBeUndefined()
    expect(await pgErrorCode(insertAccount('U-x', 'nisa'))).toBeUndefined()
  })

  it('accounts に存在しない account_id への unpaid INSERT は FK 違反（23503）', async () => {
    expect(
      await pgErrorCode(
        db.execute(
          sql`INSERT INTO mitsui_sumitomo_unpaids
              (unpaid_aggregate_id, account_id, current_month_unpaid_total, payload)
              VALUES (${newUlid()}, ${newUlid()}, 0, '{}'::jsonb)`,
        ),
      ),
    ).toBe('23503')
  })
})

describe('インデックス', () => {
  it('partial index idx_transactions_unclassified が存在する', async () => {
    // Db は ドライバ横断型のため execute の戻りは unknown 相当 — pg の QueryResult へ絞る
    const result = (await db.execute(
      sql`SELECT indexdef FROM pg_indexes
          WHERE tablename = 'transactions' AND indexname = 'idx_transactions_unclassified'`,
    )) as { rows: Array<{ indexdef: string }> }
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.indexdef).toContain("WHERE (kind = 'unclassified'")
  })

  it('idx_transactions_owner_occurred が存在する', async () => {
    const result = (await db.execute(
      sql`SELECT 1 FROM pg_indexes
          WHERE tablename = 'transactions' AND indexname = 'idx_transactions_owner_occurred'`,
    )) as { rows: unknown[] }
    expect(result.rows).toHaveLength(1)
  })
})
