import {
  AccountBalanceUpdatedSchema,
  InvariantViolationError,
  UnpaidBookkeptSchema,
  UnpaidSettledSchema,
  UnpaidEntryIdSchema,
  applySmbcBalanceChange,
  bookUnpaid,
  money,
  settleUnpaid,
} from '@warimaru/domain'
import type {
  AccountRepository,
  CardUsageTransactionImported,
  EventBus,
  MitsuiSumitomoUnpaidRepository,
  SettlementNoticeReceived,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { domainEventBase } from './event-base.js'
import { safeSubscribe } from './safe-subscribe.js'

export interface UnpaidBalanceUpdateHandlerDeps {
  mitsuiSumitomoUnpaidRepository: MitsuiSumitomoUnpaidRepository
  accountRepository: AccountRepository
}

/**
 * イベントチェーン3: 未払金計上・消込 → 口座残高更新（#69 / OQ-53 4a）
 *
 * 先行配線: 発行元は #35（メール取込バッチ）で接続する。本ハンドラーは購読側のみ。
 *
 * CardUsageTransactionImported → bookUnpaid → UnpaidBookkept
 * SettlementNoticeReceived → settleUnpaid + applySmbcBalanceChange → UnpaidSettled + AccountBalanceUpdated
 *
 * 冪等性:
 * - bookUnpaid: 同一 transactionId の二重計上は InvariantViolationError → 「計上済みスキップ」
 * - settleUnpaid: 同一 settlementNoticeId の重複適用は InvariantViolationError → 「適用済みスキップ」
 */
export function registerUnpaidBalanceUpdateEventHandlers(
  eventBus: EventBus,
  deps: UnpaidBalanceUpdateHandlerDeps,
): void {
  safeSubscribe<CardUsageTransactionImported>(
    eventBus,
    'CardUsageTransactionImported',
    async event => {
      const unpaid = await deps.mitsuiSumitomoUnpaidRepository.findById(event.unpaidAggregateId)
      if (unpaid === null) {
        throw new InvariantViolationError(`未払金集約が見つからない: ${event.unpaidAggregateId}`)
      }

      let updated: typeof unpaid
      try {
        updated = bookUnpaid(unpaid, {
          entryId: UnpaidEntryIdSchema.parse(newUlid()),
          transactionId: event.transactionId,
          amount: event.amount,
          bookedAt: event.occurredAt,
        })
      } catch (e) {
        if (e instanceof InvariantViolationError && String(e.message).includes('計上済み')) return
        throw e
      }

      await deps.mitsuiSumitomoUnpaidRepository.save(updated)
      await eventBus.publish(
        UnpaidBookkeptSchema.parse({
          ...domainEventBase(),
          type: 'UnpaidBookkept',
          unpaidAggregateId: event.unpaidAggregateId,
          entryId: updated.entries.at(-1)?.entryId,
          transactionId: event.transactionId,
          bookedAmount: event.amount,
        }),
      )
    },
  )

  safeSubscribe<SettlementNoticeReceived>(eventBus, 'SettlementNoticeReceived', async event => {
    const unpaid = await deps.mitsuiSumitomoUnpaidRepository.findById(event.unpaidAggregateId)
    if (unpaid === null) {
      throw new InvariantViolationError(`未払金集約が見つからない: ${event.unpaidAggregateId}`)
    }

    let result: ReturnType<typeof settleUnpaid>
    try {
      result = settleUnpaid(unpaid, event.settlementNoticeId, event.occurredAt)
    } catch (e) {
      if (e instanceof InvariantViolationError && String(e.message).includes('消込適用済み')) {
        return
      }
      throw e
    }

    await deps.mitsuiSumitomoUnpaidRepository.save(result.unpaid)

    const account = await deps.accountRepository.findById(event.accountId)
    if (account === null) {
      throw new InvariantViolationError(`口座が見つからない: ${event.accountId}`)
    }
    if (account.kind !== 'smbc_bank') {
      throw new InvariantViolationError(
        `SMBC 銀行口座ではない: ${event.accountId}（種別: ${account.kind}）`,
      )
    }
    const delta = money(-result.settledTotal)
    const updatedAccount = applySmbcBalanceChange(account, delta, event.occurredAt)
    await deps.accountRepository.save(updatedAccount)

    await eventBus.publish(
      UnpaidSettledSchema.parse({
        ...domainEventBase(),
        type: 'UnpaidSettled',
        unpaidAggregateId: event.unpaidAggregateId,
        settledEntryIds: result.settledEntries.map(e => e.entryId),
        settlementNoticeId: event.settlementNoticeId,
        settledTotal: result.settledTotal,
      }),
    )
    await eventBus.publish(
      AccountBalanceUpdatedSchema.parse({
        ...domainEventBase(),
        type: 'AccountBalanceUpdated',
        accountId: event.accountId,
        delta,
        newBalance: updatedAccount.balance.currentBalance,
      }),
    )
  })
}
