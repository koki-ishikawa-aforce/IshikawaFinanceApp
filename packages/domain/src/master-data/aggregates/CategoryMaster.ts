/**
 * カテゴリマスタ集約（マスタ管理コンテキスト）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 * @see docs/domain/09-aggregates.md #18
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 *
 * kawasima: data カテゴリマスタ = 規定カテゴリ OR 追加カテゴリ
 *
 * 不変条件:
 *  - 同一スコープ内でカテゴリ名は一意（save 前に findAllVisibleToUser の結果へ
 *    assertCategoryNameAvailable を適用して保証する、Phase 5 M-B）
 *  - 規定カテゴリは削除・改名不可（改名/削除の遷移関数を提供しないことで構造表現）
 *  - 規定カテゴリは世帯共有スコープ、追加カテゴリは個人別スコープ（superRefine）
 *  - 削除時は移動先カテゴリID が必ず設定される（CategoryDeletionRequest 側で構造表現）
 */
import { z } from 'zod'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import { CategoryIdSchema, type CategoryId } from '../../shared/ids'
import { OwnershipScopeSchema } from '../value-objects/OwnershipScope'
import { RenameRecordSchema } from '../value-objects/RenameRecord'
import { UserIdSchema } from '../../shared/ids'

/** 規定カテゴリ種別（4 種、削除・改名不可） */
export const DefaultCategoryKindSchema = z.enum([
  'housing_utilities_communication',
  'food',
  'entertainment',
  'other',
])
export type DefaultCategoryKind = z.infer<typeof DefaultCategoryKindSchema>

export const CategoryMasterSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('default'),
      categoryId: CategoryIdSchema,
      name: z.string().min(1),
      scope: OwnershipScopeSchema,
      defaultKind: DefaultCategoryKindSchema,
    }),
    z.object({
      kind: z.literal('custom'),
      categoryId: CategoryIdSchema,
      name: z.string().min(1),
      scope: OwnershipScopeSchema,
      createdAt: z.date(),
      createdByUserId: UserIdSchema,
      renameHistory: z.array(RenameRecordSchema),
    }),
  ])
  .superRefine((category, ctx) => {
    if (category.kind === 'default' && category.scope.kind !== 'household_shared') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '規定カテゴリは世帯共有スコープでなければならない',
        path: ['scope'],
      })
    }
    if (category.kind === 'custom' && category.scope.kind !== 'personal') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '追加カテゴリは個人別スコープでなければならない',
        path: ['scope'],
      })
    }
  })
export type CategoryMaster = z.infer<typeof CategoryMasterSchema>

export type DefaultCategory = Extract<CategoryMaster, { kind: 'default' }>
export type CustomCategory = Extract<CategoryMaster, { kind: 'custom' }>

/**
 * 名前一意性の検査（08h「名前重複エラー」）。新設・改名の save 前に、
 * findAllVisibleToUser の結果（世帯共有 + 本人の個人別）を渡して呼び出す。
 * 改名時は excludeCategoryId に自身の ID を渡す。
 */
export function assertCategoryNameAvailable(
  visibleCategories: CategoryMaster[],
  name: string,
  excludeCategoryId?: CategoryId,
): void {
  if (visibleCategories.some(c => c.categoryId !== excludeCategoryId && c.name === name)) {
    throw new InvariantViolationError(`カテゴリ名「${name}」は既に使用されている`)
  }
}

/** 追加カテゴリの改名（規定カテゴリの改名関数は提供しない = 改名不可の構造表現） */
export function renameCustomCategory(
  category: CustomCategory,
  newName: string,
  renamedByUserId: CustomCategory['createdByUserId'],
  at: Date,
): CustomCategory {
  return CategoryMasterSchema.parse({
    ...category,
    name: newName,
    renameHistory: [
      ...category.renameHistory,
      { oldName: category.name, newName, renamedAt: at, renamedByUserId },
    ],
  }) as CustomCategory
}

/**
 * 規定カテゴリの名前（08h §1 `data 規定カテゴリ種別`）。
 * 規定カテゴリは改名不可のため、この対応が名前の唯一の出典になる。
 */
export const DEFAULT_CATEGORY_NAMES: Record<DefaultCategoryKind, string> = {
  housing_utilities_communication: '住居光熱通信',
  food: '食費',
  entertainment: '娯楽',
  other: 'その他',
}

/**
 * 規定カテゴリを seed 投入する（08h: `behavior 規定カテゴリをseed投入する`）。
 *
 * 名前は改名不可の固定値のため呼び出し側から受け取らず、DEFAULT_CATEGORY_NAMES を正とする。
 * スコープが世帯共有であることは superRefine が保証する。
 */
export function seedDefaultCategory(input: {
  categoryId: CategoryId
  defaultKind: DefaultCategoryKind
}): DefaultCategory {
  return CategoryMasterSchema.parse({
    kind: 'default',
    categoryId: input.categoryId,
    name: DEFAULT_CATEGORY_NAMES[input.defaultKind],
    scope: { kind: 'household_shared' },
    defaultKind: input.defaultKind,
  }) as DefaultCategory
}
