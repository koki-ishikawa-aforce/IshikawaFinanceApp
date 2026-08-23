/**
 * 規定マスタの seed（本番・開発の共通部分）
 *
 * 規定カテゴリ 4 種・規定経費種別 5 種は世帯共有・削除改名不可の固定データで、
 * 本番でも投入が必要になる（08h §2 `behavior 規定カテゴリをseed投入する` /
 * `behavior 規定経費種別をseed投入する`）。開発用のダミーデータは
 * dev-fixtures.ts に分けている。
 *
 * 規定経費種別が DB に無いと、役割確定を契機に月次上限を作るハンドラー
 * （packages/api/src/event-handlers/monthly-limit-seed.ts）が反復対象を 0 件と見なし、
 * 月次上限が 1 件も作られない（エラーにもならない）。
 *
 * 集約の組み立てはドメインの seed 関数（名前と世帯共有スコープの正）に委ね、
 * 永続化は repository に委ねる。row マッピングも不変条件も、ここでは再実装しない。
 *
 * 冪等: repository の save が主キー upsert のため、何度実行しても結果は同じ。
 */
import { CategoryIdSchema, ExpenseTypeIdSchema } from '@warimaru/domain'
import type { DefaultCategoryKind, DefaultExpenseTypeKind } from '@warimaru/domain'
import { seedDefaultCategory, seedDefaultExpenseType } from '@warimaru/domain'
import type { Db } from '../../src/client'
import { PostgresCategoryMasterRepository } from '../../src/master-data/PostgresCategoryMasterRepository'
import { PostgresExpenseTypeMasterRepository } from '../../src/master-data/PostgresExpenseTypeMasterRepository'

export const CAT_HOUSING = '01JAAAAAAAAAAAAAAAAAAAAAA1'
export const CAT_FOOD = '01JAAAAAAAAAAAAAAAAAAAAAA2'
export const CAT_ENTERTAINMENT = '01JAAAAAAAAAAAAAAAAAAAAAA3'
export const CAT_OTHER = '01JAAAAAAAAAAAAAAAAAAAAAA4'

export const EXPENSE_TYPE_GYM = '01JEEEEEEEEEEEEEEEEEEEEEE1'
export const EXPENSE_TYPE_BOOKS = '01JEEEEEEEEEEEEEEEEEEEEEE2'
export const EXPENSE_TYPE_AI = '01JEEEEEEEEEEEEEEEEEEEEEE3'
export const EXPENSE_TYPE_TRANSPORTATION = '01JEEEEEEEEEEEEEEEEEEEEEE4'
export const EXPENSE_TYPE_OTHER = '01JEEEEEEEEEEEEEEEEEEEEEE5'

/** 規定カテゴリ 4 種の ID 割り当て（名前はドメインの DEFAULT_CATEGORY_NAMES が正） */
export const DEFAULT_CATEGORY_SEEDS: { id: string; defaultKind: DefaultCategoryKind }[] = [
  { id: CAT_HOUSING, defaultKind: 'housing_utilities_communication' },
  { id: CAT_FOOD, defaultKind: 'food' },
  { id: CAT_ENTERTAINMENT, defaultKind: 'entertainment' },
  { id: CAT_OTHER, defaultKind: 'other' },
]

/** 規定経費種別 5 種の ID 割り当て（名前はドメインの DEFAULT_EXPENSE_TYPE_NAMES が正） */
export const DEFAULT_EXPENSE_TYPE_SEEDS: { id: string; defaultKind: DefaultExpenseTypeKind }[] = [
  { id: EXPENSE_TYPE_GYM, defaultKind: 'gym' },
  { id: EXPENSE_TYPE_BOOKS, defaultKind: 'books_newspaper' },
  { id: EXPENSE_TYPE_AI, defaultKind: 'ai_usage' },
  { id: EXPENSE_TYPE_TRANSPORTATION, defaultKind: 'transportation' },
  { id: EXPENSE_TYPE_OTHER, defaultKind: 'other_expense' },
]

export async function seedDefaultMasters(db: Db): Promise<void> {
  const categoryRepository = new PostgresCategoryMasterRepository(db)
  const expenseTypeRepository = new PostgresExpenseTypeMasterRepository(db)

  console.log('Seeding category_masters...')
  for (const c of DEFAULT_CATEGORY_SEEDS) {
    await categoryRepository.save(
      seedDefaultCategory({
        categoryId: CategoryIdSchema.parse(c.id),
        defaultKind: c.defaultKind,
      }),
    )
  }

  console.log('Seeding expense_type_masters...')
  for (const e of DEFAULT_EXPENSE_TYPE_SEEDS) {
    await expenseTypeRepository.save(
      seedDefaultExpenseType({
        expenseTypeId: ExpenseTypeIdSchema.parse(e.id),
        defaultKind: e.defaultKind,
      }),
    )
  }
}
