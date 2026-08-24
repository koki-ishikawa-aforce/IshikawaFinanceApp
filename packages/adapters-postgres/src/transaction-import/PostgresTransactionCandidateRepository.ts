/**
 * TransactionCandidateRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * - gmail_message_id の昇格元は importSource の 2 kind（スキーマ docstring 参照）
 * - findByTripleMatch の「発生日」は JST 暦日（§3 の月境界規約の暦日版）。
 *   save 時の occurred_on 導出と検索時のパラメータ変換に同じ関数を使う
 * - メール重複除外は partial unique が最終保証（violation は InvariantViolationError へ翻訳）
 */
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import type {
  AmazonOrderId,
  GmailMessageId,
  Money,
  NormalTransactionCandidate,
  TransactionCandidate,
  TransactionCandidateId,
  TransactionCandidateRepository,
  UploadFileId,
  UserId,
} from '@warimaru/domain'
import {
  AmazonOrderIdSchema,
  InvariantViolationError,
  TransactionCandidateSchema,
} from '@warimaru/domain'
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

export class PostgresTransactionCandidateRepository implements TransactionCandidateRepository {
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

  async findByCsvFileId(csvFileId: UploadFileId): Promise<TransactionCandidate[]> {
    // csv_file_id は昇格列を持たないため payload（importSource union の kind='csv'）を直接参照する
    const rows = await this.db
      .select({ payload: transactionCandidates.payload })
      .from(transactionCandidates)
      .where(
        sql`${transactionCandidates.payload}->'common'->'importSource'->>'csvFileId' = ${csvFileId}`,
      )
      .orderBy(asc(transactionCandidates.transactionCandidateId))
    return rows.map(row => parsePayload(TransactionCandidateSchema, row.payload))
  }

  async findByPdfFileId(pdfFileId: UploadFileId): Promise<TransactionCandidate[]> {
    // pdf_file_id も昇格列を持たないため payload（importSource union の kind='pdf'）を直接参照する
    const rows = await this.db
      .select({ payload: transactionCandidates.payload })
      .from(transactionCandidates)
      .where(
        sql`${transactionCandidates.payload}->'common'->'importSource'->>'pdfFileId' = ${pdfFileId}`,
      )
      .orderBy(asc(transactionCandidates.transactionCandidateId))
    return rows.map(row => parsePayload(TransactionCandidateSchema, row.payload))
  }

  async findEmailSourcedNormalCandidates(
    userId: UserId,
    range: { occurredFrom?: Date; occurredTo: Date },
  ): Promise<NormalTransactionCandidate[]> {
    // 「メール由来」は昇格列 gmail_message_id の有無で見る（kind='normal' に昇格されるのは
    // importSource.kind='email' の候補だけ。amazon_match は突合後の kind なのでここには来ない）。
    //
    // occurred_on は JST 暦日への丸めなので、範囲の端では時刻ぶんだけ広めに返る。突合と
    // タイムアウトの期限判定は発生日時（時刻まで）で行う必要があるため、絞り込みの最終判定は
    // 呼出し側のドメイン関数（matchAmazonOrders / judgeCardUsageMatchTimeout）が持つ。
    // ここで暦日に丸めた範囲を返しすぎるぶんには結果は変わらない（取りこぼしだけを避ける）。
    const conditions = [
      eq(transactionCandidates.userId, userId),
      eq(transactionCandidates.kind, 'normal'),
      isNotNull(transactionCandidates.gmailMessageId),
      lte(transactionCandidates.occurredOn, dateToJstCalendarDate(range.occurredTo)),
      ...(range.occurredFrom === undefined
        ? []
        : [gte(transactionCandidates.occurredOn, dateToJstCalendarDate(range.occurredFrom))]),
    ]
    const rows = await this.db
      .select({ payload: transactionCandidates.payload })
      .from(transactionCandidates)
      .where(and(...conditions))
      .orderBy(asc(transactionCandidates.transactionCandidateId))
    return (
      rows
        .map(row => parsePayload(TransactionCandidateSchema, row.payload))
        // 列と payload の持ち主が食い違った行を返さない。突合はこの結果の候補を「別ユーザー由来の
        // 注文情報で上書き保存する」処理なので、乖離があると相手の明細に商品名が付く
        .filter(
          (c): c is NormalTransactionCandidate => c.kind === 'normal' && c.common.userId === userId,
        )
    )
  }

  async findMatchedAmazonOrderIds(
    userId: UserId,
    amazonOrderIds: readonly AmazonOrderId[],
  ): Promise<AmazonOrderId[]> {
    if (amazonOrderIds.length === 0) return []
    // amazonOrderId は昇格列を持たないため payload（importSource union の kind='amazon_match'）を
    // 直接参照する。kind では絞らない — 突合済みの候補が確定済み（confirmed）へ進んでも取込ソースは
    // amazon_match のまま残り、その注文が消費済みであることに変わりはないため
    const orderId = sql`${transactionCandidates.payload}->'common'->'importSource'->>'amazonOrderId'`
    const rows = await this.db
      .select({ amazonOrderId: orderId })
      .from(transactionCandidates)
      .where(and(eq(transactionCandidates.userId, userId), inArray(orderId, [...amazonOrderIds])))
    return rows.flatMap(row =>
      typeof row.amazonOrderId === 'string' ? [AmazonOrderIdSchema.parse(row.amazonOrderId)] : [],
    )
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
