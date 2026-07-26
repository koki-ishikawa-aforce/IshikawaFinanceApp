/**
 * マスタ管理 4 テーブルの DDL 忠実性テスト（schemaConstraints.test.ts 方式）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
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

describe('category_masters / expense_type_masters の制約', () => {
  function insertCategory(name: string, owner: string | null, kind = 'custom'): Promise<unknown> {
    return db.execute(
      sql`INSERT INTO category_masters (category_id, kind, name, owner_user_id, payload)
          VALUES (${newUlid()}, ${kind}, ${name}, ${owner}, '{}'::jsonb)`,
    )
  }

  it('不正な kind を拒否する（23514）', async () => {
    expect(await pgErrorCode(insertCategory('x', null, 'bogus'))).toBe('23514')
  })

  it('owner NULL 同士の同名は NULLS NOT DISTINCT で重複拒否（23505）', async () => {
    await insertCategory('食費', null)
    expect(await pgErrorCode(insertCategory('食費', null))).toBe('23505')
  })

  it('同名でも owner が異なれば通る', async () => {
    await insertCategory('食費', null)
    expect(await pgErrorCode(insertCategory('食費', 'U-x'))).toBeUndefined()
    expect(await pgErrorCode(insertCategory('食費', 'U-y'))).toBeUndefined()
  })

  it('expense_type_masters も同じ unique を持つ（23505）', async () => {
    const insert = (): Promise<unknown> =>
      db.execute(
        sql`INSERT INTO expense_type_masters (expense_type_id, kind, name, owner_user_id, payload)
            VALUES (${newUlid()}, 'custom', 'ジム', NULL, '{}'::jsonb)`,
      )
    await insert()
    expect(await pgErrorCode(insert())).toBe('23505')
  })
})

describe('monthly_limits の制約（論点15: マジックナンバー不使用の構造表現）', () => {
  function insertLimit(kind: string, capAmount: number | null): Promise<unknown> {
    return db.execute(
      sql`INSERT INTO monthly_limits (monthly_limit_id, user_id, expense_type_id, kind, cap_amount, payload)
          VALUES (${newUlid()}, 'U-x', ${newUlid()}, ${kind}, ${capAmount}, '{}'::jsonb)`,
    )
  }

  it('unlimited なのに cap_amount ありは拒否（23514）', async () => {
    expect(await pgErrorCode(insertLimit('unlimited', 10000))).toBe('23514')
  })

  it('capped なのに cap_amount NULL は拒否（23514）', async () => {
    expect(await pgErrorCode(insertLimit('capped', null))).toBe('23514')
  })

  it('不正な kind を拒否する（23514）', async () => {
    expect(await pgErrorCode(insertLimit('bogus', null))).toBe('23514')
  })
})

describe('phase0_configs のシングルトン制約', () => {
  function insertConfig(singleton: boolean): Promise<unknown> {
    return db.execute(
      sql`INSERT INTO phase0_configs (phase0_config_id, singleton, payload)
          VALUES (${newUlid()}, ${singleton}, '{}'::jsonb)`,
    )
  }

  it('singleton = false は CHECK 違反（23514）', async () => {
    expect(await pgErrorCode(insertConfig(false))).toBe('23514')
  })

  it('2 行目は UNIQUE 違反（23505）', async () => {
    await insertConfig(true)
    expect(await pgErrorCode(insertConfig(true))).toBe('23505')
  })
})
