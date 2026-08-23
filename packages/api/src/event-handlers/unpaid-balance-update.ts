import {
  AccountBalanceUpdatedSchema,
  ConcurrentUpdateError,
  UnpaidAlreadyBookedError,
  InvariantViolationError,
  UnpaidSettlementAlreadyAppliedError,
  UnpaidBookkeptSchema,
  UnpaidSettledSchema,
  UnpaidEntryIdSchema,
  applyUnpaidSettlementToSmbcBalance,
  bookUnpaid,
  money,
  settleUnpaid,
  settledTotalForNotice,
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
 * SettlementNoticeReceived → settleUnpaid + applyUnpaidSettlementToSmbcBalance
 *   → UnpaidSettled + AccountBalanceUpdated
 *
 * 冪等性（判定はエラー型で行う。メッセージ文言に依存しない — #388）:
 * - bookUnpaid: 同一 transactionId の二重計上は UnpaidAlreadyBookedError → 「計上済みスキップ」
 * - settleUnpaid: 同一 settlementNoticeId の重複適用は UnpaidSettlementAlreadyAppliedError
 *   → 消込は済んでいるが**残高反映は未了かもしれない**ため、後続の残高反映まで進む
 * - applyUnpaidSettlementToSmbcBalance: 残高反映済みなら UnpaidSettlementAlreadyAppliedError
 *   → 「反映済みスキップ」。二重減算はここで止まる
 *
 * 回復性（#388 / OQ-43「集約をまたぐ更新は再実行で自己修復する」）:
 * 消込の保存と残高反映は別集約への順次保存で、その間の失敗（口座が見つからない等）は
 * safeSubscribe に吸収される。同一イベントを再実行すると、消込済みでも残高反映まで
 * 到達して回復する。減算額はその通知で消し込まれたエントリ合計から引き直す。
 *
 * 再発行側（#35 メール取込バッチ）への要件:
 * - 同一の引落確定通知の再取込では**同じ settlementNoticeId を再発行する**こと。
 *   冪等ガードはこの ID の同一性が前提で、崩れると無言の二重減算または反映漏れになる。
 * - 本ハンドラーの失敗は safeSubscribe に吸収されるため**バッチ側からは成功に見える**。
 *   「処理済みメール」のマークだけを根拠に再発行を抑止すると、この回復経路は発火しない。
 * - イベント発行（publish）が例外を投げないこと（= 購読者が safeSubscribe 配下である）
 *   にも依存する。UnpaidSettled の購読者が例外を伝播させると、再実行時は
 *   result === null となり当該イベントは二度と発行されない。
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
        if (e instanceof UnpaidAlreadyBookedError) return
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

    // 消込。適用済み（再実行）なら result は null のまま残高反映へ進む
    let result: ReturnType<typeof settleUnpaid> | null = null
    try {
      result = settleUnpaid(unpaid, event.settlementNoticeId, event.occurredAt)
    } catch (e) {
      if (!(e instanceof UnpaidSettlementAlreadyAppliedError)) throw e
    }

    if (result !== null) {
      await deps.mitsuiSumitomoUnpaidRepository.save(result.unpaid)
      // 消込の保存直後に発行する。ここより後（残高反映）で失敗しても消込の事実は
      // 一度だけ伝わり、再実行時は result === null となって二重発行されない。
      // 購読側への注意: この時点で口座残高はまだ反映されていない。残高を前提にする
      // 処理は AccountBalanceUpdated を購読すること。
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
    }

    // 再実行では消込済みの集約から減算額を引き直す（result は使えない）
    const settledTotal =
      result?.settledTotal ?? settledTotalForNotice(unpaid, event.settlementNoticeId)

    // 失敗時に「どの通知・どの口座の残高が未反映か」を運用者が特定できるようにする。
    // 金額は載せない（safeSubscribe が吸収した先のログにしか残らないため）
    const refs = `noticeId=${event.settlementNoticeId} accountId=${event.accountId} unpaidAggregateId=${event.unpaidAggregateId}`

    const account = await deps.accountRepository.findById(event.accountId)
    if (account === null) {
      throw new InvariantViolationError(`口座が見つからない: ${event.accountId}（${refs}）`)
    }
    if (account.kind !== 'smbc_bank') {
      throw new InvariantViolationError(
        `SMBC 銀行口座ではない: ${event.accountId}（種別: ${account.kind}、${refs}）`,
      )
    }

    let updatedAccount: typeof account
    try {
      updatedAccount = applyUnpaidSettlementToSmbcBalance(account, {
        settlementNoticeId: event.settlementNoticeId,
        settledTotal,
        at: event.occurredAt,
      })
    } catch (e) {
      if (e instanceof UnpaidSettlementAlreadyAppliedError) {
        // 消込を今まさに保存した（result !== null）のに残高側が反映済み = 2集約の記録が
        // 食い違う異常。正常な再実行スキップと同じ無言 return にすると永久に不可視になる
        if (result !== null) {
          console.error(`未払金と口座の記録が不整合（消込は新規だが残高は反映済み）: ${refs}`)
        }
        return
      }
      throw e
    }

    try {
      await deps.accountRepository.save(updatedAccount)
    } catch (e) {
      // 版数競合（#459。手入力が同じ口座を先に書いた等）は一時的失敗で、次の再実行が
      // 最新版を読み直して自己修復する。真の save 障害（error）と混ざらないよう warn に落とす。
      if (e instanceof ConcurrentUpdateError) {
        console.warn(`引落消込の残高反映を並行更新で見送った（再実行で回復する）: ${refs}`)
      } else {
        console.error(`引落消込の残高反映に失敗（再実行で回復する）: ${refs}`)
      }
      throw e
    }

    if (result === null) {
      // 前回の実行が残高未反映で終わっていた分の回復。初回成功と区別できるようにする
      console.info(`引落消込の残高反映を再実行で回復した: ${refs}`)
    }

    await eventBus.publish(
      AccountBalanceUpdatedSchema.parse({
        ...domainEventBase(),
        type: 'AccountBalanceUpdated',
        accountId: event.accountId,
        // 符号のルール（消込は減算）はドメイン側の単一ソース。実際の残高差分から導く
        delta: money(updatedAccount.balance.currentBalance - account.balance.currentBalance),
        newBalance: updatedAccount.balance.currentBalance,
      }),
    )
  })
}
