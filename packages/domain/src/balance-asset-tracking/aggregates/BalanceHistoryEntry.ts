/**
 * 残高変動履歴エントリ集約（残高・資産推移管理コンテキスト、#398）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/09-aggregates.md #10c
 *
 * kawasima: data 残高変動履歴エントリ = 履歴エントリID AND 残高軸 AND 口座ID
 *           AND 変動後の値 AND 発生日時 AND 由来イベントID
 *
 * 資産の推移グラフが読む唯一の正。4 軸それぞれについて「いつ・いくつになったか」を
 * 1 行ずつ残す。月次レポートに凍結した値は CSV 確定時点の写しであり、グラフの正ではない
 * （#398 で OQ-53 ③ を改訂）。
 *
 * 記録は**口座ごと**（OQ-53 ③ 改訂の但し書き。口座 1 つ分の推移を出す画面 #406 のため）。
 * グラフ・月次サマリが必要とする「世帯の 1 本の線」は `householdBalanceSeriesOfAxis` が
 * 口座ごとの直近値を持ち越して合算する。
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
import { MoneySchema, money, type Money } from '../../shared/value-objects/Money'
import { BalanceAxisSchema, type BalanceAxis } from '../value-objects/BalanceAxis'

export const BalanceHistoryEntrySchema = z.object({
  entryId: BalanceHistoryEntryIdSchema,
  axis: BalanceAxisSchema,
  accountId: AccountIdSchema,
  /** 変動後の値。残高軸が積立累計・未払い合計のときもこの項目に入る（UL の「変動後の値」） */
  value: MoneySchema,
  occurredAt: z.date(),
  /**
   * この変動を伝えたドメインイベントのID。冪等性キーであり、変動の出どころを後から
   * 追うための手がかりでもある。イベントを持たない経路からは記録しない
   * （記録の起点をイベント 1 種類に絞ると、経路が増えても取りこぼしの検査対象が増えない）。
   */
  sourceEventId: z.string().min(1),
})
export type BalanceHistoryEntry = z.infer<typeof BalanceHistoryEntrySchema>

/** 世帯合算した推移の 1 点（軸ごとに「いつ・世帯でいくつか」） */
export const BalanceSeriesPointSchema = z.object({
  occurredAt: z.date(),
  value: MoneySchema,
})
export type BalanceSeriesPoint = z.infer<typeof BalanceSeriesPointSchema>

/**
 * behavior 残高の変動を履歴に記録する（08d §2）
 * 事後: 指定の残高軸に「発生日時 → 変動後の値」の点が 1 つ増える。
 */
export function recordBalanceChange(params: {
  entryId: BalanceHistoryEntryId
  axis: BalanceAxis
  accountId: AccountId
  value: Money
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
 * 指定軸の世帯合算の推移を作る（08d §2「資産の推移を読み出す」）。
 *
 * 履歴は口座ごとに残るが、グラフと LINE 月次サマリが必要とするのは世帯の 1 本の線
 * （夫婦それぞれが別銀行貯蓄口座・NISA 口座を持てるため、口座別の点をそのまま並べると
 * 線が 2 人の残高を行き来してしまい、残高一覧の世帯合計と食い違う）。
 * そこで、変動のたびに「その時点で分かっている各口座の値」を合計した 1 点を作る。
 *
 * `opening` は期間より前に記録された (口座ごとの) 最後のエントリ。期間の外で最後に動いた
 * 口座の残高を持ち越すために要る（渡さないと、期間内に動いた口座の分しか合計に入らない）。
 * opening そのものは点として出さない（期間外の日時に点を打たないため）。
 */
export function householdBalanceSeriesOfAxis(
  entries: readonly BalanceHistoryEntry[],
  axis: BalanceAxis,
  opening: readonly BalanceHistoryEntry[] = [],
): BalanceSeriesPoint[] {
  const latestByAccount = new Map<AccountId, Money>()
  for (const e of balanceHistoryOfAxis(opening, axis)) {
    latestByAccount.set(e.accountId, e.value)
  }
  return balanceHistoryOfAxis(entries, axis).map(e => {
    latestByAccount.set(e.accountId, e.value)
    let total = 0
    for (const v of latestByAccount.values()) total += v
    return BalanceSeriesPointSchema.parse({ occurredAt: e.occurredAt, value: money(total) })
  })
}

/**
 * 指定軸の世帯合算の最終値。期間内に点が無ければ `opening` の合計を返し、
 * それも無ければ null。
 *
 * null は「まだ一度も記録が無い」を表す。0 で埋めない — 積立累計 0 円と区別がつかず、
 * LINE の月次サマリに「積立ゼロ」と書いてしまう。
 */
export function latestHouseholdValueOfAxis(
  entries: readonly BalanceHistoryEntry[],
  axis: BalanceAxis,
  opening: readonly BalanceHistoryEntry[] = [],
): Money | null {
  const series = householdBalanceSeriesOfAxis(entries, axis, opening)
  const last = series.at(-1)
  if (last !== undefined) return last.value
  const openingOfAxis = balanceHistoryOfAxis(opening, axis)
  if (openingOfAxis.length === 0) return null
  const latestByAccount = new Map<AccountId, Money>()
  for (const e of openingOfAxis) latestByAccount.set(e.accountId, e.value)
  let total = 0
  for (const v of latestByAccount.values()) total += v
  return money(total)
}
