/**
 * TransactionCandidateRepository の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * - gmail_message_id の昇格元は importSource の 2 kind（スキーマ docstring 参照）
 * - findByTripleMatch の「発生日」は JST 暦日（§3 の月境界規約の暦日版）。
 *   save 時の occurred_on 導出と検索時のパラメータ変換に同じ関数を使う
 * - メール重複除外は partial unique が最終保証（violation は InvariantViolationError へ翻訳）
 */
import { and, eq } from 'drizzle-orm'
import type {
  GmailMessageId,
  Money,
  TransactionCandidate,
  TransactionCandidateId,
  TransactionCandidateRepository,
  UserId,
} from '@warimaru/domain'
import { InvariantViolationError, TransactionCandidateSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { transactionCandidates } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'
import { dateToJstCalendarDate } from '../jstCalendarDate'

function promoteGmailMessageId(candidate: TransactionCandidate): string | null {
  const source = candidate.common.importSource
  if (source.kind === 'email') return source.gmailMessageId
  if (source.kind === 'amazon_match') return source.smbcGmailMessageId
  return null
}

export class NeonTransactionCandidateRepository implements TransactionCandidateRepository {
  constructor(private readonly db: Db) {}

  async findById(id: TransactionCandidateId): Promise<TransactionCandidate | null> {
    const rows = await this.db
      .select({ payload: transactionCandidates.payload })
      .from(transactionCandidates)
      .where(eq(transactionCandidates.transactionCandidateId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(TransactionCandidateSchema, row.payload)
  }

  async findByGmailMessageId(gmailMessageId: GmailMessageId): Promise<TransactionCandidate | null> {
    // partial unique により 0..1 行
    const rows = await this.db
      .select({ payload: transactionCandidates.payload })
      .from(transactionCandidates)
      .where(eq(transactionCandidates.gmailMessageId, gmailMessageId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(TransactionCandidateSchema, row.payload)
  }

  async findByTripleMatch(
    userId: UserId,
    occurredOn: Date,
    amount: Money,
    merchantName: string,
  ): Promise<TransactionCandidate | null> {
    const rows = await this.db
      .select({ payload: transactionCandidates.payload })
      .from(transactionCandidates)
      .where(
        and(
          eq(transactionCandidates.userId, userId),
          eq(transactionCandidates.occurredOn, dateToJstCalendarDate(occurredOn)),
          eq(transactionCandidates.amount, amount),
          eq(transactionCandidates.merchantName, merchantName),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(TransactionCandidateSchema, row.payload)
  }

  async save(candidate: TransactionCandidate): Promise<void> {
    const row = {
      transactionCandidateId: candidate.common.transactionCandidateId,
      userId: candidate.common.userId,
      kind: candidate.kind,
      merchantName: candidate.common.merchantName,
      amount: candidate.common.amount,
      occurredOn: dateToJstCalendarDate(candidate.common.occurredAt),
      gmailMessageId: promoteGmailMessageId(candidate),
      payload: serializeForPayload(candidate),
    }
    const { transactionCandidateId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(transactionCandidates)
        .values(row)
        .onConflictDoUpdate({
          target: transactionCandidates.transactionCandidateId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `同一 Gmail メッセージ由来の取引候補は 1 件のみ（重複除外の閉包）: ${row.gmailMessageId ?? ''}`,
          e,
        )
      }
      throw e
    }
  }
}
