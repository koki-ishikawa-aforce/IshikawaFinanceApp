/**
 * BalanceHistoryRepository の PostgreSQL 実装（#398）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2b
 *
 * append-only（INSERT のみ実装）。冪等性は UNIQUE (axis, source_event_id) +
 * ON CONFLICT DO NOTHING に置く。ハンドラー側で「既にあるか」を先に読むと、
 * 同じイベントを並行して処理したときに検査と挿入の間をすり抜ける。
 */
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'
import type { BalanceAxis, BalanceHistoryEntry, BalanceHistoryRepository } from '@warimaru/domain'
import { BalanceHistoryEntrySchema } from '@warimaru/domain'
import type { Db } from '../client'
import { balanceHistoryEntries } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class PostgresBalanceHistoryRepository implements BalanceHistoryRepository {
  constructor(private readonly db: Db) {}

  async append(entry: BalanceHistoryEntry): Promise<void> {
    await this.db
      .insert(balanceHistoryEntries)
      .values({
        entryId: entry.entryId,
        axis: entry.axis,
        accountId: entry.accountId,
        balance: entry.balance,
        occurredAt: entry.occurredAt,
        sourceEventId: entry.sourceEventId,
        payload: serializeForPayload(entry),
      })
      // 既に記録済みの変動（同一イベントの再配信）。履歴エントリIDは記録のたびに
      // 新しく採番されるため主キーでは衝突しない。衝突させたいのは変動の同一性なので
      // (axis, source_event_id) を対象にする
      .onConflictDoNothing({
        target: [balanceHistoryEntries.axis, balanceHistoryEntries.sourceEventId],
      })
  }

  async findByOccurredAtRange(from: Date, toExclusive: Date): Promise<BalanceHistoryEntry[]> {
    const rows = await this.db
      .select({ payload: balanceHistoryEntries.payload })
      .from(balanceHistoryEntries)
      .where(
        and(
          gte(balanceHistoryEntries.occurredAt, from),
          lt(balanceHistoryEntries.occurredAt, toExclusive),
        ),
      )
      .orderBy(asc(balanceHistoryEntries.occurredAt), asc(balanceHistoryEntries.entryId))
    return rows.map(row => parsePayload(BalanceHistoryEntrySchema, row.payload))
  }

  async findLatestBefore(
    axis: BalanceAxis,
    atExclusive: Date,
  ): Promise<BalanceHistoryEntry | null> {
    const rows = await this.db
      .select({ payload: balanceHistoryEntries.payload })
      .from(balanceHistoryEntries)
      .where(
        and(
          eq(balanceHistoryEntries.axis, axis),
          lt(balanceHistoryEntries.occurredAt, atExclusive),
        ),
      )
      .orderBy(desc(balanceHistoryEntries.occurredAt), desc(balanceHistoryEntries.entryId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(BalanceHistoryEntrySchema, row.payload)
  }
}
