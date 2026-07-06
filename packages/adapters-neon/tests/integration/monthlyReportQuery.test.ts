import { describe, it, expect } from 'vitest'
import { NeonMonthlyReportQuery } from '../../src/household-analysis/NeonMonthlyReportQuery'
import { NeonMonthlyReportRepository } from '../../src/household-analysis/NeonMonthlyReportRepository'
import { db } from './setup'
import { HONEY_USER_ID, csvConfirmedReport, finalizedReport, ym } from '../helpers/fixtures'

const repo = new NeonMonthlyReportRepository(db)
const query = new NeonMonthlyReportQuery(db)

describe('NeonMonthlyReportQuery', () => {
  it('csv_confirmed は finalizedAt / unapprovedTransfers が null の View になる', async () => {
    const report = csvConfirmedReport({ targetYearMonth: ym('2026-06') })
    await repo.save(report)
    const view = await query.fetchByMonth(HONEY_USER_ID, ym('2026-06'))
    expect(view?.status).toBe('csv_confirmed')
    expect(view?.common).toEqual(report.common)
    expect(view?.finalizedAt).toBeNull()
    expect(view?.unapprovedTransfers).toBeNull()
  })

  it('finalized は finalizedAt / unapprovedTransfers を持つ View になる', async () => {
    const report = finalizedReport({ targetYearMonth: ym('2026-06') })
    await repo.save(report)
    if (report.kind !== 'finalized') throw new Error('unreachable')
    const view = await query.fetchById(HONEY_USER_ID, report.common.monthlyReportId)
    expect(view?.status).toBe('finalized')
    expect(view?.finalizedAt).toEqual(report.finalizedAt)
    expect(view?.unapprovedTransfers).toEqual(report.unapprovedTransfers)
  })

  it('存在しない月 / ID は null', async () => {
    expect(await query.fetchByMonth(HONEY_USER_ID, ym('2026-01'))).toBeNull()
    const report = csvConfirmedReport()
    expect(await query.fetchById(HONEY_USER_ID, report.common.monthlyReportId)).toBeNull()
  })
})
