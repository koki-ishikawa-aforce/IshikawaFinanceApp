import { describe, it, expect } from 'vitest'
import { ImportResultSummarySchema } from '../../../src/transaction-import/value-objects/ImportResultSummary'

describe('ImportResultSummarySchema', () => {
  it('newCount === autoClassifiedEstimateCount + unclassifiedEstimateCount なら成功', () => {
    const result = ImportResultSummarySchema.safeParse({
      newCount: 5,
      autoClassifiedEstimateCount: 3,
      unclassifiedEstimateCount: 2,
      duplicateExcludedCount: 1,
    })
    expect(result.success).toBe(true)
  })

  it('全て 0 なら成功', () => {
    const result = ImportResultSummarySchema.safeParse({
      newCount: 0,
      autoClassifiedEstimateCount: 0,
      unclassifiedEstimateCount: 0,
      duplicateExcludedCount: 0,
    })
    expect(result.success).toBe(true)
  })

  it('newCount が内訳合計と一致しない場合は失敗', () => {
    const result = ImportResultSummarySchema.safeParse({
      newCount: 10,
      autoClassifiedEstimateCount: 3,
      unclassifiedEstimateCount: 2,
      duplicateExcludedCount: 1,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1)
      const paths = result.error.issues.flatMap(i => i.path)
      expect(paths).toContain('newCount')
    }
  })

  it('duplicateExcludedCount は件数整合に影響しない', () => {
    const result = ImportResultSummarySchema.safeParse({
      newCount: 5,
      autoClassifiedEstimateCount: 3,
      unclassifiedEstimateCount: 2,
      duplicateExcludedCount: 100,
    })
    expect(result.success).toBe(true)
  })
})
