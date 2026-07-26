/**
 * 銀行入金 Repository I/F（集約: BankDeposit）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * `findByTransactionId` は同一入金の二重取込を呼び出し側が検出するための照会。
 * 一意性の最終保証は実装側の一意制約（取引ID）が担う。
 */
import type { BankDepositId, TransactionId, UserId } from '../../shared/ids'
import type { BankDeposit } from '../aggregates/BankDeposit'

export interface BankDepositRepository {
  findById(id: BankDepositId): Promise<BankDeposit | null>
  findByTransactionId(transactionId: TransactionId): Promise<BankDeposit | null>
  /** 手動確認待ち（用途不明）の入金を発生順に返す。本人分のみを渡すこと */
  findAwaitingManualConfirmationByUser(userId: UserId): Promise<BankDeposit[]>
  save(deposit: BankDeposit): Promise<void>
}
