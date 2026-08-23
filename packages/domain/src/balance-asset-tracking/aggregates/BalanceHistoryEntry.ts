/**
 * 残高変動履歴エントリ集約（残高・資産推移管理コンテキスト、#398）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/09-aggregates.md #10c
 *
 * kawasima: data 残高変動履歴エントリ = 履歴エントリID AND 残高軸 AND 口座ID
 *           AND 変動後の値 AND 発生日時 AND 由来イベントID
 *
 * 資産の推移グラフが読む唯一の正。4 軸それぞれについて「いつ・いくつになったか」を
 * 1 行ずつ残す。月次レポートに凍結した値は LINE 配信時点の写しであり、グラフの正ではない
 * （#398 で OQ-53 ③ を改訂）。
 *
 * 不変条件:
 *  - 追記のみ。一度記録した変動は書き換えない（過去のグラフが後から変わらないようにする）
 *  - 同一の (残高軸, 由来イベントID) は 1 件だけ（Repository.append が冪等に落とす）。
 *    イベント配信は at-least-once で、同じ変動が二度届いてもグラフに点が重ならないようにする
 */
import { z } from 'zod'
import {
  AccountIdSchema,
  BalanceHistoryEntryIdSchema,
  type AccountId,
  type BalanceHistoryEntryId,
} from '../../shared/ids'
import { MoneySchema, type Money } from '../../shared/value-objects/Money'
import { BalanceAxisSchema, type BalanceAxis } from '../value-objects/BalanceAxis'

export const BalanceHistoryEntrySchema = z.object({
  entryId: BalanceHistoryEntryIdSchema,
  axis: BalanceAxisSchema,
  accountId: AccountIdSchema,
  /** 変動後の値。残高軸が積立累計・未払い合計のときもこの項目に入る */
  balance: MoneySchema,
  occurredAt: z.date(),
  /**
   * この変動を伝えたドメインイベントのID。冪等性キーであり、変動の出どころを後から
   * 追うための手がかりでもある。イベントを持たない経路からは記録しない
   * （記録の起点をイベント 1 種類に絞ると、経路が増えても取りこぼしの検査対象が増えない）。
   */
  sourceEventId: z.string().min(1),
})
export type BalanceHistoryEntry = z.infer<typeof BalanceHistoryEntrySchema>

/**
 * behavior 残高の変動を履歴に記録する（08d §2）
 * 事後: 指定の残高軸に「発生日時 → 変動後の値」の点が 1 つ増える。
 */
export function recordBalanceChange(params: {
  entryId: BalanceHistoryEntryId
  axis: BalanceAxis
  accountId: AccountId
  balance: Money
  occurredAt: Date
  sourceEventId: string
}): BalanceHistoryEntry {
  return BalanceHistoryEntrySchema.parse(params)
}

/**
 * 指定軸のエントリを発生日時の昇順で取り出す。
 * 同時刻の並びは記録順（履歴エントリIDは ULID で時系列ソート可能）で決める。
 */
export function balanceHistoryOfAxis(
  entries: readonly BalanceHistoryEntry[],
  axis: BalanceAxis,
): BalanceHistoryEntry[] {
  return entries
    .filter(e => e.axis === axis)
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() || a.entryId.localeCompare(b.entryId),
    )
}

/**
 * 指定軸の最終値。エントリが 1 件も無ければ null。
 * 「点が無い月は線を飛ばす」挙動を保つため、0 で埋めない（0 円の残高と区別がつかなくなる）。
 */
export function latestBalanceOfAxis(
  entries: readonly BalanceHistoryEntry[],
  axis: BalanceAxis,
): Money | null {
  return balanceHistoryOfAxis(entries, axis).at(-1)?.balance ?? null
}
