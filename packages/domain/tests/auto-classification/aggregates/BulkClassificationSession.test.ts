import { describe, it, expect } from 'vitest'
import {
  BulkClassificationSessionSchema,
  completeBulkClassificationSession,
  abortBulkClassificationSession,
  recordBulkClassificationProgress,
  type InProgressBulkClassificationSession,
} from '../../../src/auto-classification/aggregates/BulkClassificationSession'

const TX1 = '01TX0000000000000000000001' as never
const TX2 = '01TX0000000000000000000002' as never
const TX3 = '01TX0000000000000000000003' as never

function target(transactionId: never, merchantName: string) {
  return {
    kind: 'unclassified',
    transactionId,
    merchantName,
    reason: 'merchant_rule_unlearned',
    defaultExpenseClass: 'personal_honey',
  }
}

const common = {
  bulkClassificationSessionId: '01BCS000000000000000000001' as never,
  userId: 'user_honey' as never,
  trigger: {
    kind: 'csv_import',
    importJobId: '01JB0000000000000000000001' as never,
    startedAt: new Date(),
  },
  targets: [target(TX1, 'スターバックス')],
}

/** 対象 2 件（進捗のテスト用） */
const commonWithTwoTargets = {
  ...common,
  targets: [target(TX1, 'スターバックス'), target(TX2, '東京電力')],
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

  it('取引一覧起因のセッションも parse 成功（起点の取引IDを持たない）', () => {
    const parsed = BulkClassificationSessionSchema.parse({
      kind: 'in_progress',
      common: { ...common, trigger: { kind: 'transaction_list', startedAt: new Date() } },
      startedAt: new Date(),
      remainingCount: 1,
    })
    expect(parsed.common.trigger.kind).toBe('transaction_list')
  })

  it('進捗を持たずに保存された行は 分類済み取引=空 として読み戻せる', () => {
    const parsed = BulkClassificationSessionSchema.parse({
      kind: 'in_progress',
      common,
      startedAt: new Date(),
      remainingCount: 1,
    })
    expect(parsed.kind === 'in_progress' && parsed.processedTransactionIds).toEqual([])
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
      common: commonWithTwoTargets,
      startedAt: new Date(),
      remainingCount: 2,
    }) as InProgressBulkClassificationSession
    const aborted = abortBulkClassificationSession(session, new Date())
    expect(aborted.kind).toBe('aborted')
    expect(aborted.remainingCount).toBe(2)
  })

  describe('進捗の記録', () => {
    const inProgress = () =>
      BulkClassificationSessionSchema.parse({
        kind: 'in_progress',
        common: commonWithTwoTargets,
        startedAt: new Date(),
        remainingCount: 2,
      }) as InProgressBulkClassificationSession

    it('分類し終えた対象を記録すると残件数が減る', () => {
      const advanced = recordBulkClassificationProgress(inProgress(), [TX1])
      expect(advanced.processedTransactionIds).toEqual([TX1])
      expect(advanced.remainingCount).toBe(1)
    })

    it('同じ取引を再度記録しても残件数は二重に減らない', () => {
      const once = recordBulkClassificationProgress(inProgress(), [TX1])
      const twice = recordBulkClassificationProgress(once, [TX1])
      expect(twice.processedTransactionIds).toEqual([TX1])
      expect(twice.remainingCount).toBe(1)
    })

    it('全件を記録すると残件数は 0 になり、中断してもその残件数が引き継がれる', () => {
      const advanced = recordBulkClassificationProgress(inProgress(), [TX1, TX2])
      expect(advanced.remainingCount).toBe(0)
      expect(abortBulkClassificationSession(advanced, new Date()).remainingCount).toBe(0)
    })

    it('対象に含まれない取引は分類済みにできない', () => {
      expect(() => recordBulkClassificationProgress(inProgress(), [TX3])).toThrow()
    })

    it('残件数が 対象取引数 - 分類済み取引数 と食い違う進行中は parse 失敗', () => {
      expect(() =>
        BulkClassificationSessionSchema.parse({
          kind: 'in_progress',
          common: commonWithTwoTargets,
          startedAt: new Date(),
          processedTransactionIds: [TX1],
          remainingCount: 2,
        }),
      ).toThrow()
    })

    it('分類済み取引に重複があれば parse 失敗', () => {
      expect(() =>
        BulkClassificationSessionSchema.parse({
          kind: 'in_progress',
          common: commonWithTwoTargets,
          startedAt: new Date(),
          processedTransactionIds: [TX1, TX1],
          remainingCount: 0,
        }),
      ).toThrow()
    })
  })
})
