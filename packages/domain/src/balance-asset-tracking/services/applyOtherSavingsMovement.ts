/**
 * 別銀行貯蓄口座との資金移動の反映（残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §2
 * @see docs/domain/09-aggregates.md #9
 *
 * kawasima:
 *   behavior 別銀行貯蓄残高をSMBC振込で加算する = 出金変動 AND 別銀行貯蓄口座 -> シャドウ口座更新
 *   behavior 銀行入金の用途を判別する の事後: 別銀行戻し判別 → 別銀行貯蓄口座から戻し扱いで両口座を更新
 *
 * 「どちらの向きの資金移動が、シャドウ残高をどちらへ、いくら動かすか」をここに一元的に置く
 * （CLAUDE.md「ドメイン不変条件を adapters / api 層で再実装しない」）。api 層は口座を解決して
 * 保存し、イベントを出すだけにする。
 *
 * SMBC 側の残高について:
 * 08d §2 は別銀行戻しの事後を「両口座を更新」と書くが、SMBC 側の増減は
 * `behavior 取引で口座残高を更新する`（事後: 経費(会社) 取引も含む**全取引**を反映する）が
 * 取引取込の時点ですでに適用している。ここで再度動かすと同じ入出金が二度 SMBC 残高に効く。
 * したがって本サービスはシャドウ側だけを動かし、SMBC 側には触れない。「両口座が逆符号・同額で
 * 動く」という結果は、取引取込の反映と本サービスの反映を合わせて成立する。
 */
import { money, type Money } from '../../shared/value-objects/Money'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import type { TransactionId } from '../../shared/ids'
import { applyOtherSavingsMovement, type OtherSavingsAccount } from '../aggregates/Account'

export interface OtherSavingsMovementParams {
  /** 資金移動の元になった取引。シャドウ残高の二重適用ガードのキーになる */
  transactionId: TransactionId
  /** 移動額（正）。向きは関数側が決めるため、呼び出し側は符号を持ち込まない */
  amount: Money
  at: Date
}

function assertPositive(amount: Money): void {
  if (amount <= 0) {
    throw new InvariantViolationError(
      `資金移動の金額は正である必要がある（受領: ${amount}）。向きは関数側が決めるため符号は持ち込まない`,
    )
  }
}

/**
 * 別銀行戻し（別銀行貯蓄口座 → SMBC）をシャドウ残高へ反映する。
 * 事前: 入金用途判別結果 = 別銀行戻し判別。
 * 事後: 別銀行貯蓄残高が移動額だけ減る。同一取引の二度目は拒否される（集約のガード）。
 */
export function applyOtherSavingsReturn(
  account: OtherSavingsAccount,
  params: OtherSavingsMovementParams,
): OtherSavingsAccount {
  assertPositive(params.amount)
  return applyOtherSavingsMovement(account, {
    transactionId: params.transactionId,
    delta: money(-params.amount),
    at: params.at,
  })
}

/**
 * 別銀行振込（SMBC → 別銀行貯蓄口座）をシャドウ残高へ反映する。
 * 事前: 出金用途 = 別銀行振込用。
 * 事後: 別銀行貯蓄残高が移動額だけ増える。同一取引の二度目は拒否される（集約のガード）。
 */
export function applyOtherSavingsTransfer(
  account: OtherSavingsAccount,
  params: OtherSavingsMovementParams,
): OtherSavingsAccount {
  assertPositive(params.amount)
  return applyOtherSavingsMovement(account, {
    transactionId: params.transactionId,
    delta: params.amount,
    at: params.at,
  })
}
