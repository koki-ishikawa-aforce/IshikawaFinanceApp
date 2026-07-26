import {
  ExpenseReimbursementDepositReceivedSchema,
  ExpenseReimbursementDepositSchema,
} from '@warimaru/domain'
import type {
  EventBus,
  ExpenseReimbursementDepositArrived,
  ExpenseReimbursementDepositRepository,
} from '@warimaru/domain'
import { domainEventBase } from './event-base.js'
import { safeSubscribe } from './safe-subscribe.js'

export interface ExpenseReimbursementArrivalHandlerDeps {
  expenseReimbursementDepositRepository: ExpenseReimbursementDepositRepository
}

/**
 * behavior 経費精算入金を受信する（08e §2、#390）
 *
 * 残高・資産推移管理が「経費精算入金到着イベント」を発火したら、経費精算側で
 * 突合待ちの経費精算入金を作り、「経費精算入金受信イベント」を発行する。
 * これが無いと、入金の用途を経費精算入金として確定しても突合が始まらず、
 * 月次レポートが最終確定へ昇格しない。
 *
 * 冪等性:
 * 経費精算入金ID は判別時に採番されて銀行入金集約が保持する（08d §1）。同じ入金の
 * 再確定・イベント再発行では同じ ID が渡るため、既に集約があれば作り直さずに
 * スキップする。ID を受信側で採番すると、再実行のたびに突合対象が増殖する。
 *
 * 突合待ち以外の状態（突合済み・不認定分確定済み）へ進んだ入金を巻き戻さないよう、
 * 存在チェックは状態を問わず「あればスキップ」とする。
 */
export function registerExpenseReimbursementArrivalEventHandlers(
  eventBus: EventBus,
  deps: ExpenseReimbursementArrivalHandlerDeps,
): void {
  safeSubscribe<ExpenseReimbursementDepositArrived>(
    eventBus,
    'ExpenseReimbursementDepositArrived',
    async event => {
      const existing = await deps.expenseReimbursementDepositRepository.findById(
        event.expenseReimbursementId,
      )
      if (existing !== null) return

      const deposit = ExpenseReimbursementDepositSchema.parse({
        kind: 'awaiting_match',
        common: {
          expenseReimbursementId: event.expenseReimbursementId,
          userId: event.userId,
          depositAmount: event.depositAmount,
          depositedAt: event.depositedAt,
        },
        receivedAt: event.occurredAt,
      })
      await deps.expenseReimbursementDepositRepository.save(deposit)

      await eventBus.publish(
        ExpenseReimbursementDepositReceivedSchema.parse({
          ...domainEventBase(event.occurredAt),
          type: 'ExpenseReimbursementDepositReceived',
          expenseReimbursementId: event.expenseReimbursementId,
          depositAmount: event.depositAmount,
        }),
      )
    },
  )
}
