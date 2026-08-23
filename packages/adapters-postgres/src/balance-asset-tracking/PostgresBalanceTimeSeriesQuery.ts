/**
 * BalanceTimeSeriesQuery の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2b
 *
 * 読み出し元は残高変動履歴テーブル（balance_history_entries、#398）。
 * 月次レポートの balanceTrend は LINE 配信時点の凍結値に位置づけが変わったため、
 * グラフはそちらではなく履歴を直接読む（#398 で OQ-53 ③ を改訂。月の途中に起きる
 * 残高変動は、翌月の CSV 取込まで作られない月次レポートには置き場所が無かった）。
 *
 * 点が無い月は寄与しない（欠損月として自然に抜ける）挙動は従来どおり。
 *
 * 残高は世帯フルオープンのため viewerId で絞らない（絞らないことを明示するために受け取る）。
 */
import { and, asc, gte, lt } from 'drizzle-orm'
import type {
  BalanceAxis,
  BalanceTimeSeriesQuery,
  BalanceTimeSeriesView,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import { BalanceTimeSeriesViewSchema, jstMonthStart, jstNextMonthStart } from '@warimaru/domain'
import type { Db } from '../client'
import { balanceHistoryEntries } from '../schema'

export class PostgresBalanceTimeSeriesQuery implements BalanceTimeSeriesQuery {
  constructor(private readonly db: Db) {}

  async fetch(_viewerId: UserId, from: YearMonth, to: YearMonth): Promise<BalanceTimeSeriesView> {
    const rows = await this.db
      .select({
        axis: balanceHistoryEntries.axis,
        balance: balanceHistoryEntries.balance,
        occurredAt: balanceHistoryEntries.occurredAt,
      })
      .from(balanceHistoryEntries)
      .where(
        and(
          gte(balanceHistoryEntries.occurredAt, jstMonthStart(from)),
          lt(balanceHistoryEntries.occurredAt, jstNextMonthStart(to)),
        ),
      )
      .orderBy(asc(balanceHistoryEntries.occurredAt), asc(balanceHistoryEntries.entryId))

    // Money のブランドは BalanceTimeSeriesViewSchema.parse が最後に付ける
    const byAxis: Record<BalanceAxis, { date: Date; amount: number }[]> = {
      smbc_balance: [],
      other_savings_balance: [],
      nisa_contribution: [],
      card_unpaid: [],
    }
    for (const row of rows) {
      // axis 列は CHECK 制約で 4 値に限られる。想定外の値は Zod parse が下で弾く
      byAxis[row.axis as BalanceAxis]?.push({ date: row.occurredAt, amount: row.balance })
    }

    return BalanceTimeSeriesViewSchema.parse({
      yearMonthRange: { from, to },
      smbc: byAxis.smbc_balance,
      otherSavings: byAxis.other_savings_balance,
      nisaContribution: byAxis.nisa_contribution,
      cardUnpaid: byAxis.card_unpaid,
    })
  }
}
