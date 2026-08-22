import { describe, it, expect } from 'vitest'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'
import {
  DailyMailImportBatchSchema,
  startBatchImporting,
  updateBatchImportedCount,
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

  it('取込中の進捗（取込済み件数）を更新できる', () => {
    const started = DailyMailImportBatchSchema.parse({
      kind: 'started',
      common,
    }) as StartedImportBatch
    const importing = startBatchImporting(started, new Date())
    const progressed = updateBatchImportedCount(importing, 3)
    expect(progressed.importedCount).toBe(3)
    // 進捗以外は変わらない（同じバッチの続き）
    expect(progressed.common.importBatchId).toBe(importing.common.importBatchId)
    expect(progressed.importStartedAt).toEqual(importing.importStartedAt)
  })

  it('取込済み件数は減らせない（進捗の記録として成立しない）', () => {
    const started = DailyMailImportBatchSchema.parse({
      kind: 'started',
      common,
    }) as StartedImportBatch
    const progressed = updateBatchImportedCount(startBatchImporting(started, new Date()), 3)
    expect(() => updateBatchImportedCount(progressed, 2)).toThrow(InvariantViolationError)
    // 境界: 同じ件数での書き戻し（進捗が動かなかった実行）は許す
    expect(updateBatchImportedCount(progressed, 3).importedCount).toBe(3)
  })

  it('取込済み件数は 0 以上の整数のみ', () => {
    const started = DailyMailImportBatchSchema.parse({
      kind: 'started',
      common,
    }) as StartedImportBatch
    const importing = startBatchImporting(started, new Date())
    expect(() => updateBatchImportedCount(importing, -1)).toThrow()
    expect(() => updateBatchImportedCount(importing, 1.5)).toThrow()
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
