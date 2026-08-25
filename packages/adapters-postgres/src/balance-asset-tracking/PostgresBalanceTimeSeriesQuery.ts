/**
 * BalanceTimeSeriesQuery の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2b
 *
 * 読み出し元は残高変動履歴テーブル（balance_history_entries、#398）。
 * 月次レポートの balanceTrend は CSV 確定時点の凍結値に位置づけが変わったため、
 * グラフはそちらではなく履歴を直接読む（#398 で OQ-53 ③ を改訂。月の途中に起きる
 * 残高変動は、翌月の CSV 取込まで作られない月次レポートには置き場所が無かった）。
 *
 * 履歴は口座ごとに残るため、軸ごとに世帯合算してから返す（`householdBalanceSeriesOfAxis`）。
 * 期間より前に最後に動いた口座の残高を持ち越すため、期間の起点も併せて読む。
 * `windowStart` も渡し、期間中に一度も動きが無い軸でも期間の開始時刻に補助点を
 * 置いて線が消えないようにする（`isCarriedForward: true`。#538）。
 *
 * 残高は世帯フルオープンのため viewerId で絞らない（絞らないことを明示するために受け取る）。
 */
import type {
  BalanceTimeSeriesQuery,
  BalanceTimeSeriesView,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import {
  BalanceTimeSeriesViewSchema,
  householdBalanceSeriesOfAxis,
  jstMonthStart,
  jstNextMonthStart,
} from '@warimaru/domain'
import type { Db } from '../client'
import { PostgresBalanceHistoryRepository } from './PostgresBalanceHistoryRepository'

export class PostgresBalanceTimeSeriesQuery implements BalanceTimeSeriesQuery {
  private readonly history: PostgresBalanceHistoryRepository

  constructor(db: Db) {
    this.history = new PostgresBalanceHistoryRepository(db)
  }

  async fetch(_viewerId: UserId, from: YearMonth, to: YearMonth): Promise<BalanceTimeSeriesView> {
    const windowStart = jstMonthStart(from)
    const [entries, opening] = await Promise.all([
      this.history.findByOccurredAtRange(windowStart, jstNextMonthStart(to)),
      this.history.findLatestPerAccountBefore(windowStart),
    ])

    const seriesOf = (axis: Parameters<typeof householdBalanceSeriesOfAxis>[1]) =>
      householdBalanceSeriesOfAxis(entries, axis, opening, windowStart).map(p => ({
        date: p.occurredAt,
        amount: p.value,
        isCarriedForward: p.isCarriedForward,
      }))

    return BalanceTimeSeriesViewSchema.parse({
      yearMonthRange: { from, to },
      smbc: seriesOf('smbc_balance'),
      otherSavings: seriesOf('other_savings_balance'),
      nisaContribution: seriesOf('nisa_contribution'),
      cardUnpaid: seriesOf('card_unpaid'),
    })
  }
}
