import {
  MonthlyReportCsvConfirmedSchema,
  MonthlyReportIdSchema,
  aggregateMonthlyReportTotals,
  confirmCsv,
  freezeBalanceSnapshot,
  householdBalanceSeriesOfAxis,
  jstMonthStart,
  jstNextMonthStart,
  latestHouseholdValueOfAxis,
  money,
  refreshCsvConfirmed,
} from '@warimaru/domain'
import type {
  AppUserRepository,
  BalanceHistoryRepository,
  CsvImportCompleted,
  EventBus,
  HouseholdBalanceSnapshot,
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
 * 4 軸の合算規則と「履歴が無いことを 0 と区別する」規則はドメイン側
 * （`householdBalanceSeriesOfAxis` / `latestHouseholdValueOfAxis` / `freezeBalanceSnapshot`）
 * にあり、ここでは読み出しと受け渡しだけを行う。
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
   * 対象月の残高変動履歴（08d）から、月次レポートに凍結する残高部分を読み出す（#398）。
   * 月の起点（各口座の直前値）も併せて読む — 期間中に動かなかった口座の残高も
   * 世帯の合計には入っているため。
   */
  async function loadBalanceSnapshot(month: YearMonth): Promise<HouseholdBalanceSnapshot> {
    const monthStart = jstMonthStart(month)
    const [entries, opening] = await Promise.all([
      deps.balanceHistoryRepository.findByOccurredAtRange(monthStart, jstNextMonthStart(month)),
      deps.balanceHistoryRepository.findLatestPerAccountBefore(monthStart),
    ])
    return {
      smbc: householdBalanceSeriesOfAxis(entries, 'smbc_balance', opening),
      otherSavings: householdBalanceSeriesOfAxis(entries, 'other_savings_balance', opening),
      nisaContribution: householdBalanceSeriesOfAxis(entries, 'nisa_contribution', opening),
      cardUnpaid: householdBalanceSeriesOfAxis(entries, 'card_unpaid', opening),
      nisaContributionAccumulated: latestHouseholdValueOfAxis(
        entries,
        'nisa_contribution',
        opening,
      ),
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
      // 1 月分の失敗で残りの月を巻き込まない。どの年月が未反映かはログでしか追えないため、
      // 対象年月を明記して残す（イベントIDだけでは特定できない）
      try {
        const existing = await deps.monthlyReportRepository.findByMonth(month)
        // 最終確定済みの月は触らないので、残高の読み出し（2 本の SELECT）も行わない
        if (existing !== null && existing.kind === 'finalized') continue

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
        const balanceSnapshot = await loadBalanceSnapshot(month)
        if (balanceSnapshot.nisaContributionAccumulated === null) {
          // 履歴がまだ 1 件も無い月。LINE の月次サマリは「NISA 積立累計」行を値の有無に
          // 関わらず描くため、既存の値を残して 0 で上書きしないようにしている（domain 側）。
          // 金額は載せない
          console.warn(`残高変動履歴が無いため NISA 積立累計を据え置いた（対象年月: ${month}）`)
        }

        const base =
          existing !== null
            ? refreshCsvConfirmed(existing, totals, transactionIds)
            : confirmCsv(
                {
                  monthlyReportId: MonthlyReportIdSchema.parse(newUlid()),
                  targetYearMonth: month,
                  ...totals,
                  // 残高部分は空・0 で作り、直後に履歴からの凍結値で置き換える
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
        const report = freezeBalanceSnapshot(base, balanceSnapshot)

        await deps.monthlyReportRepository.save(report)
        await eventBus.publish(
          MonthlyReportCsvConfirmedSchema.parse({
            ...domainEventBase(),
            type: 'MonthlyReportCsvConfirmed',
            monthlyReportId: report.common.monthlyReportId,
            csvConfirmedAt: report.csvConfirmedAt,
          }),
        )
      } catch (e) {
        // safeSubscribe まで投げ上げるとイベントIDしか残らず、どの年月が未反映か特定できない。
        // 対象年月を添えて記録し、残りの月は処理を続ける（1 月の失敗で全月を落とさない）
        console.error(`月次レポートの更新に失敗した（対象年月: ${month}）`, e)
      }
    }
  })
}
