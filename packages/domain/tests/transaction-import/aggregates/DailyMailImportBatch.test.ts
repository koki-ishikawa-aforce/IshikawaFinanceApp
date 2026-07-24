import { describe, it, expect } from 'vitest'
import {
  DailyMailImportBatchSchema,
  ImportTargetPeriodSchema,
  importTargetPeriodIsValid,
  startBatchImporting,
  completeBatch,
  failBatch,
  type StartedImportBatch,
} from '../../../src/transaction-import/aggregates/DailyMailImportBatch'

const common = {
  importBatchId: '01BAT000000000000000000001' as never,
  userId: 'user_honey' as never,
  launchedAt: new Date('2026-07-06T06:00:00Z'),
  targetPeriod: {
    from: new Date('2026-07-01T00:00:00Z'),
    to: new Date('2026-07-06T00:00:00Z'),
  },
}

describe('DailyMailImportBatch 集約', () => {
  it('起動済みバッチは parse 成功', () => {
    expect(() => DailyMailImportBatchSchema.parse({ kind: 'started', common })).not.toThrow()
  })

  it('取込対象期間が from ≥ to なら parse 失敗', () => {
    expect(() =>
      DailyMailImportBatchSchema.parse({
        kind: 'started',
        common: {
          ...common,
          targetPeriod: {
            from: new Date('2026-07-06T00:00:00Z'),
            to: new Date('2026-07-01T00:00:00Z'),
          },
        },
      }),
    ).toThrow()
  })

  it('起動済み → 取込中 → 完了 の遷移', () => {
    const started = DailyMailImportBatchSchema.parse({
      kind: 'started',
      common,
    }) as StartedImportBatch
    const importing = startBatchImporting(started, new Date())
    expect(importing.kind).toBe('importing')
    const completed = completeBatch(
      importing,
      { importedCount: 5, duplicateExcludedCount: 1, failedCount: 0 },
      new Date(),
    )
    expect(completed.kind).toBe('completed')
    expect(completed.duplicateExcludedCount).toBe(1)
  })

  it('起動済み → 失敗（終端）の遷移', () => {
    const started = DailyMailImportBatchSchema.parse({
      kind: 'started',
      common,
    }) as StartedImportBatch
    const failed = failBatch(started, 'Gmail API エラー', new Date())
    expect(failed.kind).toBe('failed')
    expect(failed.failureDetail).toBe('Gmail API エラー')
  })
})

describe('取込対象期間の from < to 不変条件（単一ソース）', () => {
  const earlier = new Date('2026-07-01T00:00:00Z')
  const later = new Date('2026-07-06T00:00:00Z')

  it('importTargetPeriodIsValid は from < to のときのみ true', () => {
    expect(importTargetPeriodIsValid(earlier, later)).toBe(true)
    expect(importTargetPeriodIsValid(later, earlier)).toBe(false)
    expect(importTargetPeriodIsValid(earlier, earlier)).toBe(false)
  })

  it('ImportTargetPeriodSchema は述語に従って parse 成否が決まる', () => {
    expect(() => ImportTargetPeriodSchema.parse({ from: earlier, to: later })).not.toThrow()
    expect(() => ImportTargetPeriodSchema.parse({ from: later, to: earlier })).toThrow()
    expect(() => ImportTargetPeriodSchema.parse({ from: earlier, to: earlier })).toThrow()
  })
})
