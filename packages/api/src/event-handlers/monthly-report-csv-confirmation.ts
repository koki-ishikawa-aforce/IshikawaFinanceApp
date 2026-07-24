import {
  MonthlyReportIdSchema,
  aggregateMonthlyReportTotals,
  confirmCsv,
  money,
  refreshCsvConfirmed,
} from '@warimaru/domain'
import type {
  AppUserRepository,
  CsvImportCompleted,
  EventBus,
  MonthlyReportRepository,
  TransactionRepository,
  UserRole,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import { safeSubscribe } from './safe-subscribe.js'

export interface MonthlyReportCsvConfirmationHandlerDeps {
  appUserRepository: AppUserRepository
  transactionRepository: TransactionRepository
  monthlyReportRepository: MonthlyReportRepository
}

/**
 * イベントチェーン2: CSV取込確定 → 月次レポート更新（#69 / OQ-53 1a・2a・3a）
 *
 * CsvImportCompleted を受けて、対象年月ごとに両メンバーの分類済み取引を集計し、
 * 月次レポートを CSV確定状態に昇格（または再集計）する。
 *
 * 冪等性: 同一月への再配信は refreshCsvConfirmed で上書き更新（二重登録ではない）。
 * finalized 済みレポートへの再確定は no-op（CSV確定 → 最終確定 の単方向遷移を維持）。
 */
export function registerMonthlyReportCsvConfirmationEventHandlers(
  eventBus: EventBus,
  deps: MonthlyReportCsvConfirmationHandlerDeps,
): void {
  safeSubscribe<CsvImportCompleted>(eventBus, 'CsvImportCompleted', async event => {
    const honey = await deps.appUserRepository.findByRole('honey')
    const darling = await deps.appUserRepository.findByRole('darling')
    const roleOf = (userId: string): UserRole => {
      if (honey && userId === honey.common.userId) return 'honey'
      return 'darling'
    }

    for (const month of event.targetYearMonths) {
      const honeyTxs = honey
        ? await deps.transactionRepository.findByMonth(honey.common.userId, month)
        : []
      const darlingTxs = darling
        ? await deps.transactionRepository.findByMonth(darling.common.userId, month)
        : []
      const allTransactions = [...honeyTxs, ...darlingTxs]
      const classified = allTransactions.filter(tx => tx.kind === 'classified')
      const transactionIds = classified.map(tx => tx.common.transactionId)

      const totals = aggregateMonthlyReportTotals(allTransactions, roleOf)
      const existing = await deps.monthlyReportRepository.findByMonth(month)

      if (existing !== null) {
        if (existing.kind === 'finalized') continue
        const refreshed = refreshCsvConfirmed(existing, totals, transactionIds)
        await deps.monthlyReportRepository.save(refreshed)
      } else {
        const report = confirmCsv(
          {
            monthlyReportId: MonthlyReportIdSchema.parse(newUlid()),
            targetYearMonth: month,
            ...totals,
            nisaContributionAccumulated: money(0),
            balanceTrend: {
              smbcBalanceTrend: [],
              otherSavingsBalanceTrend: [],
              nisaContributionTrend: [],
              cardUnpaidTrend: [],
            },
          },
          transactionIds,
          event.occurredAt,
        )
        await deps.monthlyReportRepository.save(report)
      }
    }
  })
}
