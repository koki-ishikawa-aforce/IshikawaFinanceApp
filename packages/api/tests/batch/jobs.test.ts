/**
 * CSV 取込リマインダーの定時起動（#416）のうち、「どの結末を失敗として上げるか」の決まりのテスト。
 *
 * 配信側（#389）は結末を戻り値で返すため、どれを異常として扱うかはバッチ側の判断になる。
 * 判断だけを固定したいので、配信そのものはスタブに置き換えて呼ぶ。
 * ハンドラー経由の起動と依存の組み立ては `handlers.test.ts` が見る。
 */
import { describe, it, expect, vi } from 'vitest'
import type { YearMonth } from '@warimaru/domain'
import { runCsvImportReminderJob } from '../../src/batch/jobs.js'
import type {
  CsvImportReminderOutcome,
  CsvImportReminderRunner,
} from '../../src/notification/csv-import-reminder.js'

const AT = new Date('2026-08-10T00:00:00+09:00')

function runnerReturning(outcome: CsvImportReminderOutcome): CsvImportReminderRunner {
  return { run: () => Promise.resolve(outcome) }
}

describe('runCsvImportReminderJob', () => {
  it('起動時刻から当月を対象にする', async () => {
    const run = vi.fn(() => Promise.resolve<CsvImportReminderOutcome>({ kind: 'sent' }))

    const summary = await runCsvImportReminderJob({ csvImportReminderRunner: { run } }, { at: AT })

    expect(run).toHaveBeenCalledWith({ targetMonth: '2026-08', at: AT })
    expect(summary.outcomes).toEqual(['targetMonth=2026-08 outcome=sent'])
  })

  it('対象年月の指定があればそれを使う', async () => {
    const run = vi.fn(() => Promise.resolve<CsvImportReminderOutcome>({ kind: 'sent' }))

    await runCsvImportReminderJob(
      { csvImportReminderRunner: { run } },
      { at: AT, targetYearMonth: '2026-07' as YearMonth },
    )

    expect(run).toHaveBeenCalledWith({ targetMonth: '2026-07', at: AT })
  })

  it('送信に失敗しても失敗にはしない（翌日の実行で送り直すため。論点23）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const summary = await runCsvImportReminderJob(
      { csvImportReminderRunner: runnerReturning({ kind: 'send_failed' }) },
      { at: AT },
    )

    expect(summary.outcomes).toEqual(['targetMonth=2026-08 outcome=send_failed'])
    expect(warn.mock.calls.flat().join(' ')).toContain('翌日の実行で送り直す')
    warn.mockRestore()
  })

  it('対象年月が当月でなければ失敗にする（直さない限りリマインダーは届かない）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      runCsvImportReminderJob(
        {
          csvImportReminderRunner: runnerReturning({
            kind: 'not_current_month',
            currentMonth: '2026-08' as YearMonth,
          }),
        },
        { at: AT, targetYearMonth: '2026-06' as YearMonth },
      ),
    ).rejects.toThrow(/csv-import-reminder/)
    vi.restoreAllMocks()
  })

  it.each([
    { kind: 'no_members' } as const,
    { kind: 'target_unresolved' } as const,
    { kind: 'already_sent_today' } as const,
    { kind: 'already_stopped' } as const,
  ])('配信されなかった結末($kind)は記録するだけで失敗にしない', async outcome => {
    const summary = await runCsvImportReminderJob(
      { csvImportReminderRunner: runnerReturning(outcome) },
      { at: AT },
    )

    expect(summary.outcomes).toEqual([`targetMonth=2026-08 outcome=${outcome.kind}`])
  })
})
