/**
 * 加盟店学習ルール集約（自動分類・学習コンテキスト）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/domain/09-aggregates.md #4
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * kawasima: data 加盟店学習ルール = 有効加盟店学習ルール OR 学習無効化加盟店ルール
 *
 * 不変条件:
 *  - F-1: ユーザーID + 加盟店名で一意（Repository 検索で保証、Phase 5 M-B）
 *  - T-2: カテゴリ・費用区分・経費種別を独立した参照として保持
 *  - 有効ルールと学習無効化が同時に存在しない（discriminated union で構造表現）
 *  - X-1: 加盟店名「AMAZON.CO.JP」は加盟店学習の対象外（Amazon商品キー学習を使用）
 *
 * 専用 ID は持たない（自然キー = userId + merchantName、09-aggregates.md #4）。
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'
import {
  CategoryLearningRefSchema,
  ExpenseClassLearningRefSchema,
  ExpenseTypeLearningRefSchema,
} from '../value-objects/LearningRefs'

/** 共通属性（自然キー） */
export const CommonMerchantLearningRuleAttrsSchema = z.object({
  userId: UserIdSchema,
  merchantName: z.string().min(1),
})
export type CommonMerchantLearningRuleAttrs = z.infer<typeof CommonMerchantLearningRuleAttrsSchema>

export const MerchantLearningRuleSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('active'),
      common: CommonMerchantLearningRuleAttrsSchema,
      categoryRef: CategoryLearningRefSchema,
      expenseClassRef: ExpenseClassLearningRefSchema,
      expenseTypeRef: ExpenseTypeLearningRefSchema,
      lastUpdatedAt: z.date(),
    }),
    z.object({
      kind: z.literal('disabled'),
      common: CommonMerchantLearningRuleAttrsSchema,
      disabledAt: z.date(),
    }),
  ])
  .superRefine((rule, ctx) => {
    // 上流の正規化（NFKC + 空白圧縮、OQ-23）は大文字小文字を畳まないため、
    // 表記ゆれをすり抜けさせないよう防御的に正規化して比較する
    if (rule.common.merchantName.normalize('NFKC').trim().toUpperCase() === 'AMAZON.CO.JP') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AMAZON.CO.JP は加盟店学習の対象外（X-1、Amazon商品キー学習を使用）',
        path: ['common', 'merchantName'],
      })
    }
  })
export type MerchantLearningRule = z.infer<typeof MerchantLearningRuleSchema>

export type ActiveMerchantLearningRule = Extract<MerchantLearningRule, { kind: 'active' }>
export type DisabledMerchantLearningRule = Extract<MerchantLearningRule, { kind: 'disabled' }>

/** 状態遷移: 有効 → 学習無効化（M-1「この加盟店は学習しない」） */
export function disableMerchantLearning(
  rule: ActiveMerchantLearningRule,
  at: Date,
): DisabledMerchantLearningRule {
  return MerchantLearningRuleSchema.parse({
    kind: 'disabled',
    common: rule.common,
    disabledAt: at,
  }) as DisabledMerchantLearningRule
}

/** 状態遷移: 学習無効化 → 再有効化（再有効化直後は全軸未学習に戻る） */
export function reenableMerchantLearning(
  rule: DisabledMerchantLearningRule,
  at: Date,
): ActiveMerchantLearningRule {
  return MerchantLearningRuleSchema.parse({
    kind: 'active',
    common: rule.common,
    categoryRef: { kind: 'unlearned' },
    expenseClassRef: { kind: 'unlearned' },
    expenseTypeRef: { kind: 'unlearned' },
    lastUpdatedAt: at,
  }) as ActiveMerchantLearningRule
}
