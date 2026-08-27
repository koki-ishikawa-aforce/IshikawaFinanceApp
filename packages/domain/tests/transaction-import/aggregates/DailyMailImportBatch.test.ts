import { describe, it, expect } from 'vitest'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'
import {
  DailyMailImportBatchSchema,
  MANUAL_MAIL_IMPORT_COOLDOWN_MS,
  judgeManualMailImportCooldown,
  resumeBatchImporting,
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

  it('取込中の引き継ぎは件数を保ち、取込開始日時だけを進める', () => {
    const started = DailyMailImportBatchSchema.parse({
      kind: 'started',
      common,
    }) as StartedImportBatch
    const leftover = updateBatchImportedCount(
      startBatchImporting(started, new Date('2026-07-06T06:00:00Z')),
      4,
    )
    const resumed = resumeBatchImporting(leftover, new Date('2026-07-06T09:00:00Z'))
    // 取り込み済みのぶんを 0 に戻すと、完了時に前回ぶんを含まない件数で上書きしてしまう
    expect(resumed.importedCount).toBe(4)
    expect(resumed.importStartedAt).toEqual(new Date('2026-07-06T09:00:00Z'))
    expect(resumed.common).toEqual(leftover.common)
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

  it('直前に完了した実行があればクールダウン中として弾き、残り時間と直近バッチの状態を返す', () => {
    const completed = completeBatch(
      startBatchImporting(started, startedAt),
      { importedCount: 1, duplicateExcludedCount: 0, failedCount: 0 },
      after(startedAt, 60_000),
    )
    // 完了から 3 分後 → 残り 7 分
    const judgment = judgeManualMailImportCooldown(completed, after(startedAt, 4 * 60_000))
    expect(judgment).toEqual({
      kind: 'cooling_down',
      retryAfterMs: 420_000,
      latestBatchKind: 'completed',
    })
  })

  it('起動しただけで取込に入る前に落ちたバッチは起動日時が起点', () => {
    // 起動を保存してから取込中の保存までの間に落ちると、この状態のまま残る
    expect(judgeManualMailImportCooldown(started, after(startedAt, 3 * 60_000))).toEqual({
      kind: 'cooling_down',
      retryAfterMs: 420_000,
      latestBatchKind: 'started',
    })
    expect(judgeManualMailImportCooldown(started, after(startedAt, 10 * 60_000))).toEqual({
      kind: 'acceptable',
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
    ).toEqual({ kind: 'cooling_down', retryAfterMs: 1, latestBatchKind: 'importing' })
  })

  it('取込中バッチの起点は取込を始めた時刻（起動時刻ではない）', () => {
    // 起動から間があいて取込が始まった実行を、起動時刻で測ると早く受け付けてしまう
    const importing = startBatchImporting(started, after(startedAt, 5 * 60_000))
    // 取込開始から 7 分後 → 残り 3 分（起動時刻起点なら残り 0 で受け付けてしまう）
    expect(judgeManualMailImportCooldown(importing, after(startedAt, 12 * 60_000))).toEqual({
      kind: 'cooling_down',
      retryAfterMs: 180_000,
      latestBatchKind: 'importing',
    })
  })

  it('引き継いだ取込中バッチは、引き継いだ実行の取込開始時刻が起点になる', () => {
    // 前の実行が残したバッチをそのまま起点にすると、いま走っている実行の最中の叩き直しを
    // 止められない（残存バッチの取込開始時刻はとうにクールダウンを過ぎている）
    const leftover = startBatchImporting(started, startedAt)
    const resumedAt = after(startedAt, 3 * 60 * 60_000)
    const resumed = resumeBatchImporting(leftover, resumedAt)
    expect(judgeManualMailImportCooldown(resumed, after(resumedAt, 60_000))).toEqual({
      kind: 'cooling_down',
      retryAfterMs: 540_000,
      latestBatchKind: 'importing',
    })
  })

  it('失敗で終わった実行の直後は待たせない（もう動いていないことが確定しているため。#628）', () => {
    const failed = failBatch(started, 'Gmail API エラー', after(startedAt, 60_000))
    // 失敗の直後（0ms 後）でも受け付ける
    expect(judgeManualMailImportCooldown(failed, after(startedAt, 60_000))).toEqual({
      kind: 'acceptable',
    })
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
      retryAfterMs: 600_000,
      latestBatchKind: 'importing',
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
