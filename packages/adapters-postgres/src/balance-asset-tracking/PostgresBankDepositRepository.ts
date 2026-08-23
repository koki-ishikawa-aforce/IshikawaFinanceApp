/**
 * BankDepositRepository の PostgreSQL 実装（#390）
 *
 * findAwaitingManualConfirmationByUser は partial index (user_id, occurred_at)
 * WHERE kind = 'unknown' が効く形。並び順は発生順（古い入金から確認させる）。
 *
 * save は bank_deposit_id の upsert。取引ID の一意制約は集約の不変条件
 * 「取引ID で一意」の最終保証で、違反は `InvariantViolationError` に翻訳して伝播する
 * （握り潰すと同一入金の二重取込が無言で通る）。
 */
import { and, asc, eq } from 'drizzle-orm'
import { InvariantViolationError } from '@warimaru/domain'
import type {
  BankDeposit,
  BankDepositId,
  BankDepositRepository,
  TransactionId,
  UserId,
} from '@warimaru/domain'
import { BankDepositSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { bankDeposits } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

/**
 * 手動確認待ちの返却上限。自動判別が外れ続けると単調に伸びるため、
 * 1 レスポンスの転送量を頭打ちにする（画面は古い順に片付ける運用）。
 */
const AWAITING_LIMIT = 100

export class PostgresBankDepositRepository implements BankDepositRepository {
  constructor(private readonly db: Db) {}

  async findById(id: BankDepositId): Promise<BankDeposit | null> {
    const rows = await this.db
      .select({ payload: bankDeposits.payload })
      .from(bankDeposits)
      .where(eq(bankDeposits.bankDepositId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(BankDepositSchema, row.payload)
  }

  async findByTransactionId(transactionId: TransactionId): Promise<BankDeposit | null> {
    const rows = await this.db
      .select({ payload: bankDeposits.payload })
      .from(bankDeposits)
      .where(eq(bankDeposits.transactionId, transactionId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(BankDepositSchema, row.payload)
  }

  async findAwaitingManualConfirmationByUser(userId: UserId): Promise<BankDeposit[]> {
    const rows = await this.db
      .select({ payload: bankDeposits.payload })
      .from(bankDeposits)
      .where(and(eq(bankDeposits.userId, userId), eq(bankDeposits.kind, 'unknown')))
      .orderBy(asc(bankDeposits.occurredAt), asc(bankDeposits.bankDepositId))
      .limit(AWAITING_LIMIT)
    return rows.map(row => parsePayload(BankDepositSchema, row.payload))
  }

  async save(deposit: BankDeposit): Promise<void> {
    const row = {
      bankDepositId: deposit.common.bankDepositId,
      transactionId: deposit.common.transactionId,
      accountId: deposit.common.accountId,
      userId: deposit.common.userId,
      kind: deposit.kind,
      occurredAt: deposit.common.occurredAt,
      payload: serializeForPayload(deposit),
    }
    const { bankDepositId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(bankDeposits)
        .values(row)
        .onConflictDoUpdate({
          target: bankDeposits.bankDepositId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      // 集約の不変条件「取引ID で一意」の最終保証。生の pg エラーのまま投げると
      // 呼び出し側（取込バッチ）が「取込済みならスキップ」を型で判定できない
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `取引ID は一意: ${deposit.common.transactionId} の入金は既に存在する`,
        )
      }
      throw e
    }
  }
}
