import { describe, it, expect } from 'vitest'
import { InvariantViolationError } from '@warimaru/domain'
import { PostgresMonthlyReportRepository } from '../../src/household-analysis/PostgresMonthlyReportRepository'
import { db } from './setup'
import { csvConfirmedReport, finalizedReport, ym } from '../helpers/fixtures'

const repo = new PostgresMonthlyReportRepository(db)

describe('PostgresMonthlyReportRepository', () => {
  it('save → findById の往復で csv_confirmed / finalized が同一に復元される', async () => {
    for (const report of [
      csvConfirmedReport({ targetYearMonth: ym('2026-05') }),
      finalizedReport({ targetYearMonth: ym('2026-06') }),
    ]) {
      await repo.save(report)
      expect(await repo.findById(report.common.monthlyReportId)).toEqual(report)
    }
  })

  it('findByMonth は対象月のレポートを返し、なければ null', async () => {
    const report = csvConfirmedReport({ targetYearMonth: ym('2026-06') })
    await repo.save(report)
    expect(await repo.findByMonth(ym('2026-06'))).toEqual(report)
    expect(await repo.findByMonth(ym('2026-07'))).toBeNull()
  })

  it('save は upsert（csv_confirmed → finalized の遷移を同一 ID で上書きできる）', async () => {
    const confirmed = csvConfirmedReport({ targetYearMonth: ym('2026-06') })
    await repo.save(confirmed)
    const finalized = finalizedReport({ targetYearMonth: ym('2026-06') })
    const transitioned = {
      ...finalized,
      common: { ...finalized.common, monthlyReportId: confirmed.common.monthlyReportId },
    }
    await repo.save(transitioned)
    const found = await repo.findById(confirmed.common.monthlyReportId)
    expect(found?.kind).toBe('finalized')
  })

  it('同一月の別レポート保存は InvariantViolationError（1 月 1 件）', async () => {
    await repo.save(csvConfirmedReport({ targetYearMonth: ym('2026-06') }))
    await expect(repo.save(csvConfirmedReport({ targetYearMonth: ym('2026-06') }))).rejects.toThrow(
      InvariantViolationError,
    )
  })
})
