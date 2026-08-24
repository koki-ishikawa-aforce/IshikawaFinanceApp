import { describe, it, expect } from 'vitest'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'
import {
  DailyMailImportBatchSchema,
  MANUAL_MAIL_IMPORT_COOLDOWN_MS,
  judgeManualMailImportCooldown,
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

describe('手動実行のクールダウン判定', () => {
  const startedAt = new Date('2026-07-06T06:00:00Z')
  const started = DailyMailImportBatchSchema.parse({
    kind: 'started',
    common: { ...common, launchedAt: startedAt },
  }) as StartedImportBatch
  const after = (base: Date, ms: number): Date => new Date(base.getTime() + ms)

  it('一度も実行していなければ受け付ける', () => {
    expect(judgeManualMailImportCooldown(null, startedAt)).toEqual({ kind: 'acceptable' })
  })

  it('直前に完了した実行があればクールダウン中として弾き、残り時間を返す', () => {
    const completed = completeBatch(
      startBatchImporting(started, startedAt),
      { importedCount: 1, duplicateExcludedCount: 0, failedCount: 0 },
      after(startedAt, 60_000),
    )
    const judgment = judgeManualMailImportCooldown(completed, after(startedAt, 60_000 + 3 * 60_000))
    expect(judgment).toEqual({
      kind: 'cooling_down',
      retryAfterMs: MANUAL_MAIL_IMPORT_COOLDOWN_MS - 3 * 60_000,
    })
  })

  it('境界: 経過がちょうどクールダウンなら受け付ける（1ms 手前は弾く）', () => {
    const importing = startBatchImporting(started, startedAt)
    expect(
      judgeManualMailImportCooldown(importing, after(startedAt, MANUAL_MAIL_IMPORT_COOLDOWN_MS)),
    ).toEqual({ kind: 'acceptable' })
    expect(
      judgeManualMailImportCooldown(
        importing,
        after(startedAt, MANUAL_MAIL_IMPORT_COOLDOWN_MS - 1),
      ),
    ).toEqual({ kind: 'cooling_down', retryAfterMs: 1 })
  })

  it('取込中バッチの起点は取込を始めた時刻（起動時刻ではない）', () => {
    // 起動から間があいて取込が始まった実行を、起動時刻で測ると早く受け付けてしまう
    const importing = startBatchImporting(started, after(startedAt, 5 * 60_000))
    expect(judgeManualMailImportCooldown(importing, after(startedAt, 12 * 60_000))).toEqual({
      kind: 'cooling_down',
      retryAfterMs: MANUAL_MAIL_IMPORT_COOLDOWN_MS - 7 * 60_000,
    })
  })

  it('失敗で終わった実行の直後も弾く（失敗しても叩き直しは間隔を空ける）', () => {
    const failed = failBatch(started, 'Gmail API エラー', after(startedAt, 60_000))
    expect(judgeManualMailImportCooldown(failed, after(startedAt, 2 * 60_000)).kind).toBe(
      'cooling_down',
    )
  })

  it('クールダウンを過ぎた進行中バッチは受け付ける（引き継ぎを止めない）', () => {
    const importing = startBatchImporting(started, startedAt)
    expect(judgeManualMailImportCooldown(importing, after(startedAt, 2 * 60 * 60_000))).toEqual({
      kind: 'acceptable',
    })
  })

  it('直近バッチの時刻が未来（時計のずれ）なら弾く。待ち時間はクールダウンを超えない', () => {
    const importing = startBatchImporting(started, after(startedAt, 60_000))
    expect(judgeManualMailImportCooldown(importing, startedAt)).toEqual({
      kind: 'cooling_down',
      retryAfterMs: MANUAL_MAIL_IMPORT_COOLDOWN_MS,
    })
  })

  it('クールダウンの長さは呼出し側で指定できる（既定は 10 分）', () => {
    expect(MANUAL_MAIL_IMPORT_COOLDOWN_MS).toBe(10 * 60_000)
    const importing = startBatchImporting(started, startedAt)
    expect(judgeManualMailImportCooldown(importing, after(startedAt, 60_000), 30_000)).toEqual({
      kind: 'acceptable',
    })
  })
})
