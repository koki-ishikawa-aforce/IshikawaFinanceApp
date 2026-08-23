/**
 * MitsuiSumitomoUnpaidRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.4
 *
 * 「Σ 計上中エントリ = 当月未払金合計」は読み出し時の
 * MitsuiSumitomoUnpaidSchema.parse（superRefine）が毎回検査する。
 * FK 違反（対応する accounts 行の不在 = 呼び出し順序のバグ）は
 * ドメイン不変条件ではないため翻訳せず伝播する。
 */
import { eq } from 'drizzle-orm'
import type {
  AccountId,
  MitsuiSumitomoUnpaid,
  MitsuiSumitomoUnpaidId,
  MitsuiSumitomoUnpaidRepository,
} from '@warimaru/domain'
import { InvariantViolationError, MitsuiSumitomoUnpaidSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { mitsuiSumitomoUnpaids } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class PostgresMitsuiSumitomoUnpaidRepository implements MitsuiSumitomoUnpaidRepository {
  constructor(private readonly db: Db) {}

  async findById(id: MitsuiSumitomoUnpaidId): Promise<MitsuiSumitomoUnpaid | null> {
    const rows = await this.db
      .select({ payload: mitsuiSumitomoUnpaids.payload })
      .from(mitsuiSumitomoUnpaids)
      .where(eq(mitsuiSumitomoUnpaids.unpaidAggregateId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MitsuiSumitomoUnpaidSchema, row.payload)
  }

  async findByCardAccountId(accountId: AccountId): Promise<MitsuiSumitomoUnpaid | null> {
    // account_id UNIQUE により 0..1 行
    const rows = await this.db
      .select({ payload: mitsuiSumitomoUnpaids.payload })
      .from(mitsuiSumitomoUnpaids)
      .where(eq(mitsuiSumitomoUnpaids.accountId, accountId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MitsuiSumitomoUnpaidSchema, row.payload)
  }

  async save(unpaid: MitsuiSumitomoUnpaid): Promise<void> {
    const row = {
      unpaidAggregateId: unpaid.unpaidAggregateId,
      accountId: unpaid.accountId,
      currentMonthUnpaidTotal: unpaid.currentMonthUnpaidTotal,
      payload: serializeForPayload(unpaid),
    }
    const { unpaidAggregateId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(mitsuiSumitomoUnpaids)
        .values(row)
        .onConflictDoUpdate({
          target: mitsuiSumitomoUnpaids.unpaidAggregateId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `未払金集約はカード口座 1 つにつき 1 件: account_id = ${unpaid.accountId} は既に存在する`,
          e,
        )
      }
      throw e
    }
  }
}
