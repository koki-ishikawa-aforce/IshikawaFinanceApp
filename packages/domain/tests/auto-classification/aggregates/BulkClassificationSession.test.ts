import { describe, it, expect } from 'vitest'
import {
  BulkClassificationSessionSchema,
  completeBulkClassificationSession,
  abortBulkClassificationSession,
  type InProgressBulkClassificationSession,
} from '../../../src/auto-classification/aggregates/BulkClassificationSession'

const common = {
  bulkClassificationSessionId: '01BCS000000000000000000001' as never,
  userId: 'user_honey' as never,
  trigger: {
    kind: 'csv_import',
    importJobId: '01JB0000000000000000000001' as never,
    startedAt: new Date(),
  },
  targets: [
    {
      kind: 'unclassified',
      transactionId: '01TX0000000000000000000001' as never,
      merchantName: 'スターバックス',
      reason: 'merchant_rule_unlearned',
      defaultExpenseClass: 'personal_honey',
    },
  ],
}

describe('BulkClassificationSession 集約', () => {
  it('進行中セッション（CSV取込起因）は parse 成功', () => {
    expect(() =>
      BulkClassificationSessionSchema.parse({
        kind: 'in_progress',
        common,
        startedAt: new Date(),
        remainingCount: 1,
      }),
    ).not.toThrow()
  })

  it('単発修正起因のセッションも parse 成功', () => {
    expect(() =>
      BulkClassificationSessionSchema.parse({
        kind: 'in_progress',
        common: {
          ...common,
          trigger: {
            kind: 'single_correction',
            transactionId: '01TX0000000000000000000001' as never,
            startedAt: new Date(),
          },
        },
        startedAt: new Date(),
        remainingCount: 1,
      }),
    ).not.toThrow()
  })

  it('残件数が負なら parse 失敗', () => {
    expect(() =>
      BulkClassificationSessionSchema.parse({
        kind: 'in_progress',
        common,
        startedAt: new Date(),
        remainingCount: -1,
      }),
    ).toThrow()
  })

  it('completeBulkClassificationSession: 進行中 → 完了', () => {
    const session = BulkClassificationSessionSchema.parse({
      kind: 'in_progress',
      common,
      startedAt: new Date(),
      remainingCount: 1,
    }) as InProgressBulkClassificationSession
    const completed = completeBulkClassificationSession(session, 1, new Date())
    expect(completed.kind).toBe('completed')
    expect(completed.processedCount).toBe(1)
  })

  it('abortBulkClassificationSession: 進行中 → 中断（残件数を保持）', () => {
    const session = BulkClassificationSessionSchema.parse({
      kind: 'in_progress',
      common,
      startedAt: new Date(),
      remainingCount: 3,
    }) as InProgressBulkClassificationSession
    const aborted = abortBulkClassificationSession(session, new Date())
    expect(aborted.kind).toBe('aborted')
    expect(aborted.remainingCount).toBe(3)
  })
})
