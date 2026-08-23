/**
 * seed の統合テスト（#322）
 *
 * 本番モード（規定マスタのみ）と開発モード（規定マスタ + 開発フィクスチャ）の
 * 投入内容・冪等性を実 PostgreSQL に対して検証する。
 *
 * 規定経費種別が投入されることは、役割確定を契機に月次上限を作るハンドラー
 * （#321）が反復対象を得られるための前提になる。ハンドラー自身の振る舞いは
 * packages/api/tests/routes/monthly-limit-seed.test.ts で検証済みのため、
 * ここでは「リポジトリが規定 5 種を返す」ところまでを繋いで確認する
 * （adapters-postgres から api のハンドラーを import するのは依存の向き違反になる）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { asc } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { ExpenseTypeMasterSchema, CategoryMasterSchema, UserIdSchema } from '@warimaru/domain'
import type { DefaultExpenseTypeKind } from '@warimaru/domain'
import { db } from './setup'
import * as schema from '../../src/schema'
import { PostgresExpenseTypeMasterRepository } from '../../src/master-data/PostgresExpenseTypeMasterRepository'
import { seedDefaultMasters } from '../../scripts/seed/masters'
import { seedDevFixtures, HONEY_ID, DARLING_ID } from '../../scripts/seed/dev-fixtures'

async function countOf(table: PgTable): Promise<number> {
  return (await db.select().from(table)).length
}

/**
 * 冪等性の比較は「投入内容」の列だけを対象にする。
 * created_at / updated_at は行の更新履歴を残すための管理列で、upsert のたびに動くのが
 * 正しい振る舞い（repository の save も `updatedAt: new Date()` を書く）。ここに含めると
 * 「2 回目の実行で管理列が動いた」ことを取り違えて検出してしまう。
 */
/** 冪等性の比較用に、マスタ全行を安定順序で取得する */
async function masterRows() {
  const categories = await db
    .select({
      categoryId: schema.categoryMasters.categoryId,
      kind: schema.categoryMasters.kind,
      name: schema.categoryMasters.name,
      ownerUserId: schema.categoryMasters.ownerUserId,
      payload: schema.categoryMasters.payload,
    })
    .from(schema.categoryMasters)
    .orderBy(asc(schema.categoryMasters.categoryId))
  const expenseTypes = await db
    .select({
      expenseTypeId: schema.expenseTypeMasters.expenseTypeId,
      kind: schema.expenseTypeMasters.kind,
      name: schema.expenseTypeMasters.name,
      ownerUserId: schema.expenseTypeMasters.ownerUserId,
      payload: schema.expenseTypeMasters.payload,
    })
    .from(schema.expenseTypeMasters)
    .orderBy(asc(schema.expenseTypeMasters.expenseTypeId))
  return { categories, expenseTypes }
}

/** 冪等性の比較用に、取引全行の投入内容を安定順序で取得する */
async function transactionRows() {
  return db
    .select({
      transactionId: schema.transactions.transactionId,
      ownerUserId: schema.transactions.ownerUserId,
      kind: schema.transactions.kind,
      merchantName: schema.transactions.merchantName,
      amount: schema.transactions.amount,
      occurredAt: schema.transactions.occurredAt,
      categoryId: schema.transactions.categoryId,
      expenseClass: schema.transactions.expenseClass,
      payload: schema.transactions.payload,
    })
    .from(schema.transactions)
    .orderBy(asc(schema.transactions.transactionId))
}

describe('seed: 本番モード（規定マスタのみ）', () => {
  beforeEach(async () => {
    await seedDefaultMasters(db)
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

  it('書き込まれた生の payload がドメインの集約として parse できる（規定は世帯共有スコープ）', async () => {
    const { categories, expenseTypes } = await masterRows()

    expect(categories).toHaveLength(4)
    for (const row of categories) {
      const category = CategoryMasterSchema.parse(row.payload)
      expect(category.kind).toBe('default')
      expect(category.scope).toEqual({ kind: 'household_shared' })
      // 一覧列と payload が食い違っていない（repository 経由の行マッピング）
      expect(category.name).toBe(row.name)
      expect(row.ownerUserId).toBeNull()
    }

    expect(expenseTypes).toHaveLength(5)
    for (const row of expenseTypes) {
      const expenseType = ExpenseTypeMasterSchema.parse(row.payload)
      expect(expenseType.kind).toBe('default')
      expect(expenseType.scope).toEqual({ kind: 'household_shared' })
      expect(expenseType.name).toBe(row.name)
      expect(row.ownerUserId).toBeNull()
    }
  })

  it('規定経費種別 5 種がリポジトリから読み出せる（#321 のハンドラーが反復する入力）', async () => {
    const repository = new PostgresExpenseTypeMasterRepository(db)
    const expenseTypes = await repository.findAllVisibleToUser(UserIdSchema.parse(HONEY_ID))

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

  it('2 回連続で実行しても全行が同一（冪等）', async () => {
    const first = await masterRows()

    await seedDefaultMasters(db)
    const second = await masterRows()

    expect(second).toEqual(first)
  })
})

describe('seed: 開発モード（規定マスタ + 開発フィクスチャ）', () => {
  beforeEach(async () => {
    await seedDefaultMasters(db)
    await seedDevFixtures(db)
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
    const firstMasters = await masterRows()
    const firstTransactions = await transactionRows()

    await seedDefaultMasters(db)
    await seedDevFixtures(db)

    expect(await masterRows()).toEqual(firstMasters)
    expect(await transactionRows()).toEqual(firstTransactions)
    expect(await countOf(schema.appUsers)).toBe(2)
    expect(await countOf(schema.accounts)).toBe(6)
    expect(await countOf(schema.mitsuiSumitomoUnpaids)).toBe(2)
  })
})
