import {
  InvariantViolationError,
  MonthlyReportFinalizedSchema,
  // 同じ barrel の finalizeCycle（サイクル確定）との取り違え防止でエイリアスする
  finalize as finalizeMonthlyReport,
} from '@warimaru/domain'
import type {
  EventBus,
  ExpenseReimbursementDepositRepository,
  MonthlyExpenseCycleFinalized,
  MonthlyExpenseCycleRepository,
  MonthlyReportRepository,
} from '@warimaru/domain'
import { domainEventBase } from './event-base.js'
import { safeSubscribe } from './safe-subscribe.js'

export interface MonthlyReportFinalizationHandlerDeps {
  monthlyExpenseCycleRepository: MonthlyExpenseCycleRepository
  expenseReimbursementDepositRepository: ExpenseReimbursementDepositRepository
  monthlyReportRepository: MonthlyReportRepository
}

/**
 * イベントチェーン: 経費精算サイクル確定 → 月次レポート最終確定（#43）
 *
 * MonthlyExpenseCycleFinalized を受けて、対象月の CSV確定月次レポートを最終確定状態に
 * 昇格し MonthlyReportFinalized を発火する（08c §2「月次レポートを最終確定状態に昇格する」。
 * 事後の LINE 配信は行わない = OQ-22）。不認定分振替リストは確定済みサイクルの
 * unapprovedTransfers を引き渡す。
 *
 * 冪等性（at-least-once 配信のため必須）:
 * - 同一入金で最終確定済みのレポートへの再配信は no-op（MonthlyReportFinalized も再発火しない）
 * - 別入金で最終確定済みの場合は不変条件違反（finalized → csv_confirmed の逆遷移も上書きも不可）
 *
 * 対象月のレポートが未作成（CSV 未確定）の場合は警告ログを出してスキップする。
 * イベントはサイクル finalize の再実行で再発行されるため（at-least-once）、レポート作成後に
 * 再実行すれば昇格を回復できる。
 */
export function registerMonthlyReportFinalizationEventHandlers(
  eventBus: EventBus,
  deps: MonthlyReportFinalizationHandlerDeps,
): void {
  safeSubscribe<MonthlyExpenseCycleFinalized>(
    eventBus,
    'MonthlyExpenseCycleFinalized',
    async event => {
      const cycle = await deps.monthlyExpenseCycleRepository.findById(event.monthlyExpenseCycleId)
      if (cycle === null || cycle.kind !== 'finalized') {
        throw new InvariantViolationError(
          `確定済みサイクルが見つからない: ${event.monthlyExpenseCycleId}（現状態: ${cycle?.kind ?? '不在'}）`,
        )
      }

      const report = await deps.monthlyReportRepository.findByMonth(cycle.common.targetYearMonth)
      if (report === null) {
        console.warn(
          `対象月の月次レポートが未作成のため最終確定をスキップする: ${cycle.common.targetYearMonth}` +
            `（サイクル finalize の再実行で回復可能: ${cycle.common.monthlyExpenseCycleId}）`,
        )
        return
      }
      if (report.kind === 'finalized') {
        if (report.expenseReimbursementId !== cycle.expenseReimbursementId) {
          throw new InvariantViolationError(
            `月次レポートは別の精算入金で最終確定済み: ${report.expenseReimbursementId}`,
          )
        }
        return
      }

      const deposit = await deps.expenseReimbursementDepositRepository.findById(
        cycle.expenseReimbursementId,
      )
      if (
        deposit === null ||
        deposit.kind === 'awaiting_match' ||
        deposit.matchedCycleId !== cycle.common.monthlyExpenseCycleId
      ) {
        throw new InvariantViolationError(
          `サイクルと突合済みの精算入金が見つからない: ${cycle.expenseReimbursementId}`,
        )
      }

      const finalized = finalizeMonthlyReport(
        report,
        cycle.expenseReimbursementId,
        deposit.matchedAt,
        cycle.unapprovedTransfers,
        cycle.finalizedAt,
      )
      await deps.monthlyReportRepository.save(finalized)
      await eventBus.publish(
        MonthlyReportFinalizedSchema.parse({
          ...domainEventBase(),
          type: 'MonthlyReportFinalized',
          monthlyReportId: finalized.common.monthlyReportId,
          finalizedAt: finalized.finalizedAt,
          expenseReimbursementId: finalized.expenseReimbursementId,
        }),
      )
    },
  )
}
