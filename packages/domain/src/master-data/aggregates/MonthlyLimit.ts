/**
 * 月次上限集約（マスタ管理コンテキスト）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 * @see docs/domain/09-aggregates.md #20
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 *
 * kawasima: data 月次上限 = 上限あり月次上限 OR 無制限月次上限
 *
 * 不変条件:
 *  - ユーザーID + 経費種別ID で一意（Repository.findByUserAndExpenseType で保証、Phase 5 M-B）
 *  - 論点15: 「上限あり」と「無制限」は OR で完全分離。無制限は上限金額を構造的に持たない
 *    （`.strict()` で余剰キーを拒否、マジックナンバー不使用）
 */
import { z } from 'zod'
import type { ExpenseTypeId, MonthlyLimitId, UserId } from '../../shared/ids'
import { MonthlyLimitIdSchema, UserIdSchema, ExpenseTypeIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import type { UserRole } from '../../shared/value-objects/UserRole'
import { SeedLimitSchema, type SeedLimit } from '../value-objects/SeedLimit'
import type { DefaultExpenseTypeKind } from './ExpenseTypeMaster'

/** 上限変更履歴レコード */
export const LimitChangeRecordSchema = z.object({
  oldCapAmount: MoneySchema,
  newCapAmount: MoneySchema,
  changedAt: z.date(),
  changedByUserId: UserIdSchema,
  changeReason: z.string().optional(),
})
export type LimitChangeRecord = z.infer<typeof LimitChangeRecordSchema>

export const MonthlyLimitSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('capped'),
    monthlyLimitId: MonthlyLimitIdSchema,
    userId: UserIdSchema,
    expenseTypeId: ExpenseTypeIdSchema,
    effectiveFrom: z.date(),
    capAmount: MoneySchema,
    changeHistory: z.array(LimitChangeRecordSchema),
  }),
  z
    .object({
      kind: z.literal('unlimited'),
      monthlyLimitId: MonthlyLimitIdSchema,
      userId: UserIdSchema,
      expenseTypeId: ExpenseTypeIdSchema,
      effectiveFrom: z.date(),
    })
    .strict(),
])
export type MonthlyLimit = z.infer<typeof MonthlyLimitSchema>

export type CappedMonthlyLimit = Extract<MonthlyLimit, { kind: 'capped' }>
export type UnlimitedMonthlyLimit = Extract<MonthlyLimit, { kind: 'unlimited' }>

/**
 * AI 利用費のロール別ベース上限（OQ-19 で確定）。
 * Honey = 夫役 10,000 円 / Darling = 妻役 3,000 円（08f §ロール表記）。
 * 案件等での一時的な追加請求は「月次上限を変更する」で対応する（月別オーバーライドは持たない）。
 */
const AI_USAGE_BASE_CAP: Record<UserRole, number> = {
  honey: 10_000,
  darling: 3_000,
}

/** ジム・新聞図書費のベース上限（OQ-19 追加決定、2026-07-25）。ロールによらず共通 */
const ROLE_COMMON_BASE_CAP: Partial<Record<DefaultExpenseTypeKind, number>> = {
  gym: 5_000,
  books_newspaper: 5_000,
}

/**
 * 規定経費種別のロール別 seed 上限を決める（論点14 / OQ-19）。
 *
 * - AI 利用費: ロール別（Honey 10,000 円 / Darling 3,000 円）
 * - ジム・新聞図書費: ロール共通 5,000 円
 * - 交通費・その他経費: 上限運用の対象外のため無制限で開始（論点15 の無制限表現を使う）
 */
export function defaultSeedLimitFor(
  role: UserRole,
  defaultKind: DefaultExpenseTypeKind,
): SeedLimit {
  if (defaultKind === 'ai_usage') {
    return SeedLimitSchema.parse({ kind: 'capped', capAmount: AI_USAGE_BASE_CAP[role] })
  }
  const commonCap = ROLE_COMMON_BASE_CAP[defaultKind]
  if (commonCap !== undefined) {
    return SeedLimitSchema.parse({ kind: 'capped', capAmount: commonCap })
  }
  return SeedLimitSchema.parse({ kind: 'unlimited' })
}

/**
 * 月次上限を seed 投入する（08h: `behavior 月次上限をseed投入する`）。
 *
 * 論点14 の「DB 初期化時に個人別に seed 投入・Phase 1 の役割で自動紐付け」を、
 * 役割確定（`RoleJudged`）を契機に実行するための集約生成関数。
 * 一意性（userId + expenseTypeId）は呼び出し側が
 * `MonthlyLimitRepository.findByUserAndExpenseType` で保証する。
 */
export function seedMonthlyLimit(input: {
  monthlyLimitId: MonthlyLimitId
  userId: UserId
  expenseTypeId: ExpenseTypeId
  seedLimit: SeedLimit
  seededAt: Date
}): MonthlyLimit {
  const common = {
    monthlyLimitId: input.monthlyLimitId,
    userId: input.userId,
    expenseTypeId: input.expenseTypeId,
    effectiveFrom: input.seededAt,
  }
  if (input.seedLimit.kind === 'capped') {
    return MonthlyLimitSchema.parse({
      kind: 'capped',
      ...common,
      capAmount: input.seedLimit.capAmount,
      changeHistory: [],
    })
  }
  return MonthlyLimitSchema.parse({ kind: 'unlimited', ...common })
}
