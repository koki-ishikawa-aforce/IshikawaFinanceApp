/**
 * 規定マスタの seed（本番・開発の共通部分）
 *
 * 規定カテゴリ 4 種・規定経費種別 5 種は世帯共有・削除改名不可の固定データで、
 * 本番でも投入が必要になる（05-scenario-b-onboarding.md「経費種別マスタ規定5種が
 * DB に seed 投入された」）。開発用のダミーデータは dev-fixtures.ts に分けている。
 *
 * 規定経費種別が DB に無いと、役割確定を契機に月次上限を作るハンドラー
 * （packages/api/src/event-handlers/monthly-limit-seed.ts）が反復対象を 0 件と見なし、
 * 月次上限が 1 件も作られない（エラーにもならない）。
 *
 * 冪等: upsert のみで DELETE / TRUNCATE を含まない。
 */
import type { Db } from '../../src/client'
import * as schema from '../../src/schema'
import { serializeForPayload } from '../../src/serialize'

export const CAT_HOUSING = '01JAAAAAAAAAAAAAAAAAAAAAA1'
export const CAT_FOOD = '01JAAAAAAAAAAAAAAAAAAAAAA2'
export const CAT_ENTERTAINMENT = '01JAAAAAAAAAAAAAAAAAAAAAA3'
export const CAT_OTHER = '01JAAAAAAAAAAAAAAAAAAAAAA4'

export const EXPENSE_TYPE_GYM = '01JEEEEEEEEEEEEEEEEEEEEEE1'
export const EXPENSE_TYPE_BOOKS = '01JEEEEEEEEEEEEEEEEEEEEEE2'
export const EXPENSE_TYPE_AI = '01JEEEEEEEEEEEEEEEEEEEEEE3'
export const EXPENSE_TYPE_TRANSPORTATION = '01JEEEEEEEEEEEEEEEEEEEEEE4'
export const EXPENSE_TYPE_OTHER = '01JEEEEEEEEEEEEEEEEEEEEEE5'

/** 規定カテゴリ 4 種（DefaultCategoryKindSchema と対応） */
export const DEFAULT_CATEGORIES = [
  { id: CAT_HOUSING, name: '住居光熱通信', defaultKind: 'housing_utilities_communication' },
  { id: CAT_FOOD, name: '食費', defaultKind: 'food' },
  { id: CAT_ENTERTAINMENT, name: '娯楽', defaultKind: 'entertainment' },
  { id: CAT_OTHER, name: 'その他', defaultKind: 'other' },
] as const

/** 規定経費種別 5 種（DefaultExpenseTypeKindSchema と対応。08h §1） */
export const DEFAULT_EXPENSE_TYPES = [
  { id: EXPENSE_TYPE_GYM, name: 'ジム', defaultKind: 'gym' },
  { id: EXPENSE_TYPE_BOOKS, name: '新聞図書費', defaultKind: 'books_newspaper' },
  { id: EXPENSE_TYPE_AI, name: 'AI利用費', defaultKind: 'ai_usage' },
  { id: EXPENSE_TYPE_TRANSPORTATION, name: '交通費', defaultKind: 'transportation' },
  { id: EXPENSE_TYPE_OTHER, name: 'その他経費', defaultKind: 'other_expense' },
] as const

function makeCategoryPayload(categoryId: string, name: string, defaultKind: string) {
  return serializeForPayload({
    kind: 'default',
    categoryId,
    name,
    scope: { kind: 'household_shared' },
    defaultKind,
  })
}

function makeExpenseTypePayload(expenseTypeId: string, name: string, defaultKind: string) {
  return serializeForPayload({
    kind: 'default',
    expenseTypeId,
    name,
    scope: { kind: 'household_shared' },
    defaultKind,
  })
}

export async function seedDefaultMasters(db: Db, now: Date): Promise<void> {
  console.log('Seeding category_masters...')
  for (const c of DEFAULT_CATEGORIES) {
    const row = {
      categoryId: c.id,
      kind: 'default' as const,
      name: c.name,
      ownerUserId: null,
      payload: makeCategoryPayload(c.id, c.name, c.defaultKind),
    }
    await db
      .insert(schema.categoryMasters)
      .values(row)
      .onConflictDoUpdate({
        target: schema.categoryMasters.categoryId,
        set: { name: row.name, payload: row.payload, updatedAt: now },
      })
  }

  console.log('Seeding expense_type_masters...')
  for (const e of DEFAULT_EXPENSE_TYPES) {
    const row = {
      expenseTypeId: e.id,
      kind: 'default' as const,
      name: e.name,
      ownerUserId: null,
      payload: makeExpenseTypePayload(e.id, e.name, e.defaultKind),
    }
    await db
      .insert(schema.expenseTypeMasters)
      .values(row)
      .onConflictDoUpdate({
        target: schema.expenseTypeMasters.expenseTypeId,
        set: { name: row.name, payload: row.payload, updatedAt: now },
      })
  }
}
