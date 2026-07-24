/**
 * 取込結果サマリ（CSV 取込完了時の表示・通知用）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 */
import { z } from 'zod'

export const ImportResultSummarySchema = z
  .object({
    newCount: z.number().int().nonnegative(),
    autoClassifiedEstimateCount: z.number().int().nonnegative(),
    unclassifiedEstimateCount: z.number().int().nonnegative(),
    duplicateExcludedCount: z.number().int().nonnegative(),
  })
  .superRefine((data, ctx) => {
    if (data.newCount !== data.autoClassifiedEstimateCount + data.unclassifiedEstimateCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'newCount は autoClassifiedEstimateCount + unclassifiedEstimateCount と一致しなければならない',
        path: ['newCount'],
      })
    }
  })
export type ImportResultSummary = z.infer<typeof ImportResultSummarySchema>
