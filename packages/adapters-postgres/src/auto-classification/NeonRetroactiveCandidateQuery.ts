/**
 * RetroactiveCandidateQuery の Neon 実装（J-3: 過去未分類への遡及提案）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 家計分析の transactions テーブルを Read 横断する（Query は他コンテキストの
 * テーブルを読んでよい — 第 1 波 NeonDashboardQuery が accounts を読むのと同じ許容）。
 * F-1: userId は閲覧者かつ対象者。昇格カラムのみで完結し payload は読まない。
 */
import { and, asc, eq } from 'drizzle-orm'
import type { RetroactiveCandidateQuery, RetroactiveCandidateView, UserId } from '@warimaru/domain'
import { RetroactiveCandidateViewSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { transactions } from '../schema'

export interface NeonRetroactiveCandidateQueryDeps {
  /** View の proposedAt に使う現在時刻（テスト決定性のため注入） */
  now: () => Date
}

export class NeonRetroactiveCandidateQuery implements RetroactiveCandidateQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: NeonRetroactiveCandidateQueryDeps,
  ) {}

  async fetchCandidates(userId: UserId, merchantName: string): Promise<RetroactiveCandidateView> {
    const rows = await this.db
      .select({
        transactionId: transactions.transactionId,
        occurredAt: transactions.occurredAt,
        amount: transactions.amount,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.ownerUserId, userId),
          eq(transactions.kind, 'unclassified'),
          eq(transactions.merchantName, merchantName),
        ),
      )
      .orderBy(asc(transactions.occurredAt), asc(transactions.transactionId))
    return RetroactiveCandidateViewSchema.parse({
      userId,
      merchantName,
      candidates: rows,
      proposedAt: this.deps.now(),
    })
  }
}
