import {
  MonthlyReportCsvConfirmedSchema,
  MonthlyReportIdSchema,
  aggregateMonthlyReportTotals,
  balanceHistoryOfAxis,
  confirmCsv,
  freezeBalanceSnapshot,
  jstMonthStart,
  jstNextMonthStart,
  latestBalanceOfAxis,
  money,
  refreshCsvConfirmed,
} from '@warimaru/domain'
import type {
  AppUserRepository,
  BalanceHistoryRepository,
  BalanceTrend,
  CsvImportCompleted,
  EventBus,
  Money,
  MonthlyReportRepository,
  TransactionRepository,
  UserRole,
  YearMonth,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { domainEventBase } from './event-base.js'
import { safeSubscribe } from './safe-subscribe.js'

export interface MonthlyReportCsvConfirmationHandlerDeps {
  appUserRepository: AppUserRepository
  transactionRepository: TransactionRepository
  monthlyReportRepository: MonthlyReportRepository
  balanceHistoryRepository: BalanceHistoryRepository
}

/**
 * イベントチェーン2: CSV取込確定 → 月次レポート更新（#69 / OQ-53 1a・2a・3a）
 *
 * CsvImportCompleted を受けて、対象年月ごとに両メンバーの分類済み取引を集計し、
 * 月次レポートを CSV確定状態に昇格（または再集計）する。
 *
 * 残高部分（balanceTrend / nisaContributionAccumulated）は残高変動履歴（08d）から
 * 写し取る凍結値（#398）。以前はゼロ・空で初期化したまま埋める処理がどこにも無く、
 * 資産の推移グラフに線が出ず、LINE 月次サマリからも残高 3 行が消えていた。
 *
 * 冪等性: 同一月への再配信は refreshCsvConfirmed で上書き更新（二重登録ではない）。
 * 残高の凍結値も同じく履歴から入れ直す（履歴が正なので、何度写しても同じ値に収束する）。
 * finalized 済みレポートへの再確定は no-op（CSV確定 → 最終確定 の単方向遷移を維持）。
 */
export function registerMonthlyReportCsvConfirmationEventHandlers(
  eventBus: EventBus,
  deps: MonthlyReportCsvConfirmationHandlerDeps,
): void {
  /**
   * 対象月の残高変動履歴（08d）から、月次レポートに凍結する残高部分を組み立てる（#398）。
   * LINE の月次サマリはこの凍結値を読むため、ここが空だと残高 3 行がサマリから消える。
   * 点が 1 つも無い軸は空配列のままにする（0 で埋めると「残高 0 円」と区別がつかない）。
   */
  async function buildBalanceSnapshot(month: YearMonth): Promise<{
    balanceTrend: BalanceTrend
    nisaContributionAccumulated: Money
  }> {
    const monthStart = jstMonthStart(month)
    const entries = await deps.balanceHistoryRepository.findByOccurredAtRange(
      monthStart,
      jstNextMonthStart(month),
    )
    return {
      balanceTrend: {
        smbcBalanceTrend: balanceHistoryOfAxis(entries, 'smbc_balance').map(e => ({
          date: e.occurredAt,
          balance: e.balance,
        })),
        otherSavingsBalanceTrend: balanceHistoryOfAxis(entries, 'other_savings_balance').map(e => ({
          date: e.occurredAt,
          balance: e.balance,
        })),
        nisaContributionTrend: balanceHistoryOfAxis(entries, 'nisa_contribution').map(e => ({
          date: e.occurredAt,
          accumulated: e.balance,
        })),
        cardUnpaidTrend: balanceHistoryOfAxis(entries, 'card_unpaid').map(e => ({
          date: e.occurredAt,
          unpaidTotal: e.balance,
        })),
      },
      // 積立累計は月末時点の値。当月に積立が無くても前月までの累計は残っているので、
      // 月内に点が無ければ月初より前へさかのぼって引き継ぐ（0 に落とすと LINE の
      // 月次サマリが「積立ゼロ」と読める）
      nisaContributionAccumulated:
        latestBalanceOfAxis(entries, 'nisa_contribution') ??
        (await deps.balanceHistoryRepository.findLatestBefore('nisa_contribution', monthStart))
          ?.balance ??
        money(0),
    }
  }

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

      const balanceSnapshot = await buildBalanceSnapshot(month)

      if (existing !== null) {
        if (existing.kind === 'finalized') continue
        const refreshed = freezeBalanceSnapshot(
          refreshCsvConfirmed(existing, totals, transactionIds),
          balanceSnapshot,
        )
        await deps.monthlyReportRepository.save(refreshed)
        await eventBus.publish(
          MonthlyReportCsvConfirmedSchema.parse({
            ...domainEventBase(),
            type: 'MonthlyReportCsvConfirmed',
            monthlyReportId: refreshed.common.monthlyReportId,
            csvConfirmedAt: refreshed.csvConfirmedAt,
          }),
        )
      } else {
        const report = confirmCsv(
          {
            monthlyReportId: MonthlyReportIdSchema.parse(newUlid()),
            targetYearMonth: month,
            ...totals,
            ...balanceSnapshot,
          },
          transactionIds,
          event.occurredAt,
        )
        await deps.monthlyReportRepository.save(report)
        await eventBus.publish(
          MonthlyReportCsvConfirmedSchema.parse({
            ...domainEventBase(),
            type: 'MonthlyReportCsvConfirmed',
            monthlyReportId: report.common.monthlyReportId,
            csvConfirmedAt: report.csvConfirmedAt,
          }),
        )
      }
    }
  })
}
