/**
 * 銀行入金の用途判別に伴う事後処理（08d §2「銀行入金の用途を判別する」の事後条件）
 *
 * 用途が確定した入金について、コンテキストをまたぐ反映を 1 か所で行う:
 * - 給与判別 → SMBC 残高の加算は「取引で口座残高を更新する」が取引取込の時点で
 *   済ませているため、ここでは残高を動かさない（動かすと二重加算になる）
 * - 別銀行戻し判別 → 別銀行貯蓄口座（シャドウ）から同額を減算する
 * - 経費精算入金判別 → 経費精算へ「経費精算入金到着イベント」を発火する
 *
 * 判別ルール・資金移動の向きと金額の不変条件・二重適用のガードはドメイン側
 * （`determineBankDepositPurpose` / `applyOtherSavingsReturn` / `applyOtherSavingsTransfer`）
 * にあり、ここでは再実装しない。この層の責務は口座の解決・保存・イベント発行だけ。
 *
 * 取込バッチ（#35 / #414）からも同じ関数を呼べるよう、Hono に依存させない。
 *
 * 再実行について（OQ-43「集約をまたぐ更新は再実行で自己修復する」）:
 * 入金集約の保存とここでの反映は別集約への順次保存で、間で失敗すると「確定済みだが
 * 未反映」が残る。同じ用途での再確定は冪等なので、呼び出し側は再実行でここまで到達させて
 * よい。二重反映は適用済み取引IDのガードが防ぐ。
 */
import {
  AccountBalanceUpdatedSchema,
  BankDepositPurposeDeterminedSchema,
  ConcurrentUpdateError,
  ExpenseReimbursementDepositArrivedSchema,
  InvariantViolationError,
  OtherSavingsMovementAlreadyAppliedError,
  applyOtherSavingsReturn,
  applyOtherSavingsTransfer,
  asOtherSavingsAccount,
  money,
} from '@warimaru/domain'
import type {
  AccountRepository,
  DeterminedBankDeposit,
  EventBus,
  Money,
  OtherSavingsAccount,
  TransactionId,
  UserId,
} from '@warimaru/domain'
import { domainEventBase } from '../event-handlers/index.js'

export interface BankDepositPurposeServiceDeps {
  accountRepository: AccountRepository
  eventBus: EventBus
}

/**
 * 所有者の別銀行貯蓄口座を解決する。
 *
 * 未登録なら反映できない。無言で読み飛ばすと SMBC 側だけ動いて世帯の資産合計が
 * 資金移動のたびにずれるため、失敗として表面化させる。文言は利用者が次に取る行動
 * （設定画面での口座登録）が分かる形にする。
 */
async function resolveOtherSavingsAccount(
  deps: BankDepositPurposeServiceDeps,
  userId: UserId,
  refs: string,
): Promise<OtherSavingsAccount> {
  const accounts = await deps.accountRepository.findByOwner(userId)
  const otherSavings = accounts.find(a => a.kind === 'other_savings')
  if (otherSavings === undefined) {
    // 409 のレスポンス本文にしかならないと運用側から追えないため、ログにも残す。
    // 金額・振込元名・ユーザーIDは載せない（PII と機微情報をログに出さない）
    console.error(`別銀行貯蓄口座が未登録のため資金移動を反映できない: ${refs}`)
    throw new InvariantViolationError(
      '別銀行貯蓄口座が登録されていないため、貯蓄口座とのやりとりを残高に反映できません。設定画面で貯蓄口座を登録してから、もう一度お試しください。',
    )
  }
  return asOtherSavingsAccount(otherSavings)
}

/** シャドウ口座を保存し、口座残高更新イベントを発行する */
async function saveAndPublish(
  deps: BankDepositPurposeServiceDeps,
  before: OtherSavingsAccount,
  after: OtherSavingsAccount,
  at: Date,
  refs: string,
): Promise<void> {
  try {
    await deps.accountRepository.save(after)
  } catch (e) {
    // 版数競合（#459。手入力が同じ口座を先に書いた等）は一時的失敗で、次の再実行が
    // 最新版を読み直して自己修復する。真の save 障害（error）と混ざらないよう warn に落とす。
    if (e instanceof ConcurrentUpdateError) {
      console.warn(`別銀行貯蓄残高の反映を並行更新で見送った（再実行で回復する）: ${refs}`)
    } else {
      console.error(`別銀行貯蓄残高の反映に失敗（再実行で回復する）: ${refs}`)
    }
    throw e
  }
  await deps.eventBus.publish(
    AccountBalanceUpdatedSchema.parse({
      ...domainEventBase(at),
      type: 'AccountBalanceUpdated',
      accountId: after.common.accountId,
      // 符号のルールはドメイン側の単一ソース。実際の残高差分から導く
      delta: money(after.balance.currentBalance - before.balance.currentBalance),
      newBalance: after.balance.currentBalance,
    }),
  )
}

/**
 * behavior 別銀行貯蓄残高をSMBC振込で加算する（08d §2）
 *
 * 事前: 出金用途 = 別銀行振込用（`determineWithdrawalPurpose` の判別結果）。
 * 反映済みの取引なら何もしない（冪等）。
 *
 * 発行元は日次メール取込バッチ（#414 / #35）で接続する。#390 の時点では判別ドメインと
 * 反映だけを先行実装しており、本番の自動起動はバッチの実装後に始まる。
 */
export async function applyOtherSavingsTransferFromWithdrawal(
  deps: BankDepositPurposeServiceDeps,
  params: { userId: UserId; amount: Money; transactionId: TransactionId; at: Date },
): Promise<void> {
  const refs = `transactionId=${params.transactionId}`
  const account = await resolveOtherSavingsAccount(deps, params.userId, refs)
  let updated: OtherSavingsAccount
  try {
    updated = applyOtherSavingsTransfer(account, {
      transactionId: params.transactionId,
      amount: params.amount,
      at: params.at,
    })
  } catch (e) {
    if (e instanceof OtherSavingsMovementAlreadyAppliedError) return
    throw e
  }
  await saveAndPublish(deps, account, updated, params.at, refs)
}

/**
 * 用途が確定した入金の事後処理を適用し、入金用途判別イベントを発行する。
 *
 * 呼び出し側は入金集約を保存したうえでこれを呼ぶ。再実行（at-least-once）では
 * 各イベントが再発行されうるため、購読側は冪等に実装すること。
 */
export async function applyDeterminedBankDepositPurpose(
  deps: BankDepositPurposeServiceDeps,
  deposit: DeterminedBankDeposit,
  at: Date,
): Promise<void> {
  const refs = `bankDepositId=${deposit.common.bankDepositId} transactionId=${deposit.common.transactionId} purpose=${deposit.kind}`

  if (deposit.kind === 'other_savings_return') {
    const account = await resolveOtherSavingsAccount(deps, deposit.common.userId, refs)
    try {
      const updated = applyOtherSavingsReturn(account, {
        transactionId: deposit.common.transactionId,
        amount: deposit.common.amount,
        at,
      })
      await saveAndPublish(deps, account, updated, at, refs)
    } catch (e) {
      // 反映済みの再実行（同じ用途での再確定）はスキップして後続の発行へ進む
      if (!(e instanceof OtherSavingsMovementAlreadyAppliedError)) throw e
    }
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
    // 経費精算へ入金の到着を伝え、08e の「経費精算入金を受信する」を起動する（08d §2 事後）。
    // 経費精算入金ID は集約が保持する値をそのまま使う。ここで採番すると再実行のたびに
    // 別 ID になり、購読側で突合対象が増殖する
    await deps.eventBus.publish(
      ExpenseReimbursementDepositArrivedSchema.parse({
        ...domainEventBase(at),
        type: 'ExpenseReimbursementDepositArrived',
        bankDepositId: deposit.common.bankDepositId,
        transactionId: deposit.common.transactionId,
        userId: deposit.common.userId,
        expenseReimbursementId: deposit.expenseReimbursementId,
        depositAmount: deposit.common.amount,
        depositedAt: deposit.common.occurredAt,
      }),
    )
  }
}
