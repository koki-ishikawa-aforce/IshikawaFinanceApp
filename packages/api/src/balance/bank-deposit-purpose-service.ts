/**
 * 銀行入金の用途判別に伴う事後処理（08d §2「銀行入金の用途を判別する」の事後条件）
 *
 * 用途が確定した入金について、コンテキストをまたぐ反映を 1 か所で行う:
 * - 給与判別 / 経費精算入金判別 → SMBC 残高の加算は「取引で口座残高を更新する」が
 *   取引取込の時点で済ませているため、ここでは残高を動かさない（二重加算になる）
 * - 別銀行戻し判別 → 別銀行貯蓄口座（シャドウ）から同額を減算する。SMBC 側の加算は
 *   上と同じ理由でここでは行わない
 * - 経費精算入金判別 → 経費精算へ「経費精算入金到着イベント」を発火する
 *
 * 判別ルールそのもの・両口座を逆符号同額で動かす不変条件はドメイン側
 * （`determineBankDepositPurpose` / `applyOtherSavingsMovement`）にあり、ここでは再実装しない。
 *
 * 取込バッチ（#35 / #414）からも同じ関数を呼べるよう、Hono に依存させない。
 */
import {
  AccountBalanceUpdatedSchema,
  BankDepositPurposeDeterminedSchema,
  ExpenseReimbursementDepositReceivedSchema,
  InvariantViolationError,
  applyOtherSavingsBalanceChange,
  asOtherSavingsAccount,
  money,
} from '@warimaru/domain'
import type {
  AccountRepository,
  DeterminedBankDeposit,
  EventBus,
  Money,
  UserId,
} from '@warimaru/domain'
import { domainEventBase } from '../event-handlers/index.js'

export interface BankDepositPurposeServiceDeps {
  accountRepository: AccountRepository
  eventBus: EventBus
}

/**
 * 所有者の別銀行貯蓄口座（シャドウ）の残高を delta だけ動かし、口座残高更新イベントを発行する。
 *
 * 口座が未登録なら反映できない。無言で読み飛ばすと SMBC 側だけ動いて世帯の資産合計が
 * 資金移動のたびにずれるため、`InvariantViolationError` で表面化させる。
 */
async function applyShadowBalanceDelta(
  deps: BankDepositPurposeServiceDeps,
  params: { userId: UserId; delta: Money; at: Date; refs: string },
): Promise<void> {
  const accounts = await deps.accountRepository.findByOwner(params.userId)
  const otherSavings = accounts.find(a => a.kind === 'other_savings')
  if (otherSavings === undefined) {
    throw new InvariantViolationError(
      `別銀行貯蓄口座が未登録のため資金移動を反映できない（${params.refs}）`,
    )
  }
  const updated = applyOtherSavingsBalanceChange(
    asOtherSavingsAccount(otherSavings),
    params.delta,
    params.at,
  )
  await deps.accountRepository.save(updated)
  await deps.eventBus.publish(
    AccountBalanceUpdatedSchema.parse({
      ...domainEventBase(params.at),
      type: 'AccountBalanceUpdated',
      accountId: updated.common.accountId,
      delta: params.delta,
      newBalance: updated.balance.currentBalance,
    }),
  )
}

/**
 * behavior 別銀行貯蓄残高をSMBC振込で加算する（08d §2）
 *
 * 事前: 出金用途 = 別銀行振込用（`determineWithdrawalPurpose` の判別結果）。
 *
 * 発行元は日次メール取込バッチ（#414 / #35）で接続する。#390 の時点では判別ドメインと
 * 反映だけを先行実装しており、本番の自動起動はバッチの実装後に始まる。
 */
export async function applyOtherSavingsTransferFromWithdrawal(
  deps: BankDepositPurposeServiceDeps,
  params: { userId: UserId; amount: Money; transactionId: string; at: Date },
): Promise<void> {
  if (params.amount <= 0) {
    throw new InvariantViolationError('別銀行振込の金額は正である必要がある')
  }
  await applyShadowBalanceDelta(deps, {
    userId: params.userId,
    delta: params.amount,
    at: params.at,
    refs: `userId=${params.userId} transactionId=${params.transactionId}`,
  })
}

/**
 * 用途が確定した入金の事後処理を適用し、入金用途判別イベントを発行する。
 *
 * 呼び出し側は入金集約を保存したうえでこれを呼ぶ。再実行（at-least-once）では
 * 入金用途判別イベントが再発行されうるため、購読側は冪等に実装すること。
 */
export async function applyDeterminedBankDepositPurpose(
  deps: BankDepositPurposeServiceDeps,
  deposit: DeterminedBankDeposit,
  at: Date,
): Promise<void> {
  if (deposit.kind === 'other_savings_return') {
    // 別銀行戻し: SMBC 側の加算は取引取込時の残高更新が済ませているため、
    // ここではシャドウ側の減算だけを行う（両方動かすと SMBC が二重加算になる）
    await applyShadowBalanceDelta(deps, {
      userId: deposit.common.userId,
      delta: money(-deposit.common.amount),
      at,
      refs: `bankDepositId=${deposit.common.bankDepositId} transactionId=${deposit.common.transactionId}`,
    })
  }

  await deps.eventBus.publish(
    BankDepositPurposeDeterminedSchema.parse({
      ...domainEventBase(at),
      type: 'BankDepositPurposeDetermined',
      bankDepositId: deposit.common.bankDepositId,
      accountId: deposit.common.accountId,
      transactionId: deposit.common.transactionId,
      userId: deposit.common.userId,
      amount: deposit.common.amount,
      purpose: deposit.kind,
      ...(deposit.kind === 'expense_reimbursement'
        ? { expenseReimbursementId: deposit.expenseReimbursementId }
        : {}),
      determinationSource: deposit.determinationSource,
    }),
  )

  if (deposit.kind === 'expense_reimbursement') {
    // 経費精算へ入金の到着を伝える（08d §2 事後 → 08e の突合を起動する）。
    // 経費精算入金ID は集約が保持する値をそのまま使う。ここで採番すると
    // 再実行のたびに別 ID になり、購読側で突合対象が増殖する
    await deps.eventBus.publish(
      ExpenseReimbursementDepositReceivedSchema.parse({
        ...domainEventBase(at),
        type: 'ExpenseReimbursementDepositReceived',
        expenseReimbursementId: deposit.expenseReimbursementId,
        depositAmount: deposit.common.amount,
      }),
    )
  }
}
