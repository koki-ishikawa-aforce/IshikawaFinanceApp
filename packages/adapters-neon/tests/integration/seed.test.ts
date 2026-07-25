/**
 * seed の統合テスト（#322）
 *
 * 本番モード（規定マスタのみ）と開発モード（規定マスタ + 開発フィクスチャ）の
 * 投入内容・冪等性を実 PostgreSQL に対して検証する。
 *
 * 規定経費種別が投入されることは、役割確定を契機に月次上限を作るハンドラー
 * （#321）が反復対象を得られるための前提になる。ハンドラー自身の振る舞いは
 * packages/api/tests/routes/monthly-limit-seed.test.ts で検証済みのため、
 * ここでは「リポジトリが規定 5 種を返す」ところまでを繋いで確認する。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { asc } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { ExpenseTypeMasterSchema, CategoryMasterSchema, UserIdSchema } from '@warimaru/domain'
import type { DefaultExpenseTypeKind } from '@warimaru/domain'
import { db } from './setup'
import * as schema from '../../src/schema'
import { NeonExpenseTypeMasterRepository } from '../../src/master-data/NeonExpenseTypeMasterRepository'
import {
  seedDefaultMasters,
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_TYPES,
} from '../../scripts/seed/masters'
import { seedDevFixtures, HONEY_ID, DARLING_ID } from '../../scripts/seed/dev-fixtures'

const NOW = new Date('2026-07-15T03:00:00.000Z')

async function countOf(table: PgTable): Promise<number> {
  return (await db.select().from(table)).length
}

describe('seed: 本番モード（規定マスタのみ）', () => {
  beforeEach(async () => {
    await seedDefaultMasters(db, NOW)
  })

  it('規定カテゴリ 4 種と規定経費種別 5 種が投入される', async () => {
    expect(await countOf(schema.categoryMasters)).toBe(4)
    expect(await countOf(schema.expenseTypeMasters)).toBe(5)
  })

  it('開発フィクスチャは投入されない', async () => {
    expect(await countOf(schema.appUsers)).toBe(0)
    expect(await countOf(schema.accounts)).toBe(0)
    expect(await countOf(schema.transactions)).toBe(0)
    expect(await countOf(schema.mitsuiSumitomoUnpaids)).toBe(0)
  })

  it('投入した payload がドメインの集約として妥当（世帯共有・削除改名不可の規定種別）', async () => {
    const repository = new NeonExpenseTypeMasterRepository(db)
    const expenseTypes = await repository.findAllVisibleToUser(UserIdSchema.parse(HONEY_ID))

    expect(expenseTypes).toHaveLength(5)
    for (const expenseType of expenseTypes) {
      // parse が通ること自体が不変条件（規定は household_shared）の検証になる
      expect(() => ExpenseTypeMasterSchema.parse(expenseType)).not.toThrow()
      expect(expenseType.kind).toBe('default')
      expect(expenseType.scope).toEqual({ kind: 'household_shared' })
    }

    const kinds = expenseTypes
      .filter((e): e is Extract<typeof e, { kind: 'default' }> => e.kind === 'default')
      .map(e => e.defaultKind)
      .sort()
    const expected: DefaultExpenseTypeKind[] = [
      'ai_usage',
      'books_newspaper',
      'gym',
      'other_expense',
      'transportation',
    ]
    expect(kinds).toEqual(expected)
  })

  it('カテゴリの payload もドメインの集約として妥当', async () => {
    const rows = await db
      .select({ payload: schema.categoryMasters.payload })
      .from(schema.categoryMasters)
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(() => CategoryMasterSchema.parse(row.payload)).not.toThrow()
    }
  })

  it('2 回連続で実行しても結果が同じ（冪等）', async () => {
    await seedDefaultMasters(db, NOW)

    expect(await countOf(schema.categoryMasters)).toBe(4)
    expect(await countOf(schema.expenseTypeMasters)).toBe(5)
  })

  it('名前は 08h の規定 5 種と一致する', () => {
    const names = DEFAULT_EXPENSE_TYPES.map(e => e.name)
    expect(names).toEqual(['ジム', '新聞図書費', 'AI利用費', '交通費', 'その他経費'])
    expect(DEFAULT_CATEGORIES.map(c => c.name)).toEqual(['住居光熱通信', '食費', '娯楽', 'その他'])
  })
})

describe('seed: 開発モード（規定マスタ + 開発フィクスチャ）', () => {
  beforeEach(async () => {
    await seedDefaultMasters(db, NOW)
    await seedDevFixtures(db, NOW)
  })

  it('従来どおり開発フィクスチャ一式が投入される', async () => {
    expect(await countOf(schema.appUsers)).toBe(2)
    expect(await countOf(schema.accounts)).toBe(6)
    expect(await countOf(schema.mitsuiSumitomoUnpaids)).toBe(2)
    expect(await countOf(schema.transactions)).toBe(29)
  })

  it('規定マスタも合わせて投入される', async () => {
    expect(await countOf(schema.categoryMasters)).toBe(4)
    expect(await countOf(schema.expenseTypeMasters)).toBe(5)
  })

  it('夫婦2人がそれぞれのロールで投入される', async () => {
    const rows = await db
      .select({ userId: schema.appUsers.userId, role: schema.appUsers.role })
      .from(schema.appUsers)
      .orderBy(asc(schema.appUsers.role))
    expect(rows).toEqual([
      { userId: DARLING_ID, role: 'darling' },
      { userId: HONEY_ID, role: 'honey' },
    ])
  })

  it('2 回連続で実行しても結果が同じ（冪等）', async () => {
    await seedDefaultMasters(db, NOW)
    await seedDevFixtures(db, NOW)

    expect(await countOf(schema.appUsers)).toBe(2)
    expect(await countOf(schema.accounts)).toBe(6)
    expect(await countOf(schema.mitsuiSumitomoUnpaids)).toBe(2)
    expect(await countOf(schema.transactions)).toBe(29)
    expect(await countOf(schema.categoryMasters)).toBe(4)
    expect(await countOf(schema.expenseTypeMasters)).toBe(5)
  })
})
