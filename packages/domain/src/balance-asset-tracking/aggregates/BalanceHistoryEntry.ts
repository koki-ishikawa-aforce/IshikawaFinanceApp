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
import { MoneySchema, money, subtractMoney, type Money } from '../../shared/value-objects/Money'
import { BalanceAxisSchema, type BalanceAxis } from '../value-objects/BalanceAxis'
import { ManualEntryMemoSchema, type ManualEntryMemo } from '../value-objects/ManualEntryMemo'
import { OtherSavingsUpdateSourceSchema } from '../value-objects/OtherSavingsUpdateSource'

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

/** 指定の口座・軸のエントリを発生日時の昇順で取り出す（口座 1 件を読む入口） */
function historyOfAccountAxis(
  entries: readonly BalanceHistoryEntry[],
  accountId: AccountId,
  axis: BalanceAxis,
): BalanceHistoryEntry[] {
  return balanceHistoryOfAxis(entries, axis).filter(e => e.accountId === accountId)
}

/** 期間の起点として使える値か（口座・軸が一致していること） */
function openingValueOf(
  opening: BalanceHistoryEntry | null,
  accountId: AccountId,
  axis: BalanceAxis,
): Money | null {
  if (opening === null) return null
  return opening.accountId === accountId && opening.axis === axis ? opening.value : null
}

/**
 * 口座 1 件の推移（口座詳細画面 #406 の単線グラフ）。
 *
 * 世帯合算（`householdBalanceSeriesOfAxis`）と違い、合計する相手がいないので
 * 履歴の点をそのまま並べる。違いは期間の起点の扱いで、`opening`（期間より前に
 * 記録された最後の値）を期間の開始時刻の点として置く。置かないと、期間中に
 * 一度も動かなかった口座のグラフが「データなし」になり、残高があるのに線が
 * 消えたように見える。
 *
 * 口座IDを受け取って絞るのは、読み出し側の絞り込み漏れがそのまま
 * 「線が他人の口座の残高を行き来する」になるため（世帯合算と違い、混ざっても
 * 合計として辻褄が合ってしまい気づけない）。
 */
export function accountBalanceSeriesOfAxis(params: {
  entries: readonly BalanceHistoryEntry[]
  accountId: AccountId
  axis: BalanceAxis
  opening: BalanceHistoryEntry | null
  windowStart: Date
}): BalanceSeriesPoint[] {
  const points = historyOfAccountAxis(params.entries, params.accountId, params.axis).map(e =>
    BalanceSeriesPointSchema.parse({ occurredAt: e.occurredAt, value: e.value }),
  )
  const openingValue = openingValueOf(params.opening, params.accountId, params.axis)
  if (openingValue === null) return points
  // 期間の開始ちょうどに記録があると、起点と同じ時刻に点が 2 つ並ぶ（取込由来の
  // 発生日時は JST 0 時ちょうどになるため実際に起こる）。その場合は起点を置かない
  if (points[0]?.occurredAt.getTime() === params.windowStart.getTime()) return points
  return [
    BalanceSeriesPointSchema.parse({
      occurredAt: params.windowStart,
      value: openingValue,
    }),
    ...points,
  ]
}

/**
 * 履歴の 1 行に手入力の情報を添えるための最小の形。別銀行貯蓄の手入力記録
 * （`OtherSavingsManualEntry`）と NISA の手入力記録（`NisaManualEntry`）の
 * どちらもこの形を満たすため、軸ごとに関数を分けずに済む。
 *
 * 種別は更新由来（`OtherSavingsUpdateSource`）の手入力 2 値をそのまま借りる。
 * 手入力を表す語を軸ごと・レイヤーごとに作り直さないため。
 */
export interface ManualEntryAnnotation {
  kind: ManualBalanceUpdateSource
  enteredAt: Date
  memo?: ManualEntryMemo | undefined
}

/** 更新由来のうち手入力の 2 値（残高変動履歴の行に添える種別） */
export const ManualBalanceUpdateSourceSchema = OtherSavingsUpdateSourceSchema.extract([
  'manual_withdrawal',
  'manual_correction',
])
export type ManualBalanceUpdateSource = z.infer<typeof ManualBalanceUpdateSourceSchema>

/**
 * 口座 1 件の残高変動履歴の 1 行（口座詳細画面 #406 が並べる履歴）。
 * 自動反映（取込・引落の消込・振込の判別）と手入力が 1 つの並びに混ざる。
 */
export const AccountBalanceHistoryRowSchema = z.object({
  occurredAt: z.date(),
  /** 変動後の値。積立累計・未払い合計のときもここに入る（履歴エントリと同じ） */
  valueAfter: MoneySchema,
  /**
   * 直前に分かっている値からの増減。マイナスは減少。
   * 起点が分からない最初の 1 行だけ null（それ以前の値を持たないため差を出せない）。
   */
  delta: MoneySchema.nullable(),
  /** 手入力に由来する行はその種別、それ以外（取込・引落の反映など）は 'auto' */
  source: z.union([z.literal('auto'), ManualBalanceUpdateSourceSchema]),
  memo: ManualEntryMemoSchema.optional(),
})
export type AccountBalanceHistoryRow = z.infer<typeof AccountBalanceHistoryRowSchema>

/**
 * behavior 口座 1 件の残高変動履歴を組み立てる（08d §2「口座詳細を読み出す」）。
 *
 * 値の正は残高変動履歴（残高が動いた経路すべてが 1 行を残す）で、手入力記録は
 * 「その行が手入力だったか・メモは何か」を添えるためだけに使う。逆にすると、
 * 自動反映（取込・引落の消込・振込の判別）が履歴から落ちる。
 *
 * 突き合わせは発生日時の一致で行う。手入力の経路は、口座に積む記録の入力日時と
 * 発行するイベントの発生日時に同じ時刻を渡すため一致する（合わない行は 'auto' に
 * 落ちるだけで、金額と件数はどちらの経路でも狂わない）。
 *
 * 並びは発生日時の昇順。新しい順に見せるかは読み手（画面）が決める。
 */
export function accountBalanceHistoryRows(params: {
  entries: readonly BalanceHistoryEntry[]
  accountId: AccountId
  axis: BalanceAxis
  opening: BalanceHistoryEntry | null
  manualEntries: readonly ManualEntryAnnotation[]
}): AccountBalanceHistoryRow[] {
  const manualByEnteredAt = new Map<number, ManualEntryAnnotation>(
    params.manualEntries.map(m => [m.enteredAt.getTime(), m]),
  )
  let previous: Money | null = openingValueOf(params.opening, params.accountId, params.axis)

  return historyOfAccountAxis(params.entries, params.accountId, params.axis).map(entry => {
    const manual = manualByEnteredAt.get(entry.occurredAt.getTime())
    const row = AccountBalanceHistoryRowSchema.parse({
      occurredAt: entry.occurredAt,
      valueAfter: entry.value,
      delta: previous === null ? null : subtractMoney(entry.value, previous),
      source: manual?.kind ?? 'auto',
      ...(manual?.memo === undefined ? {} : { memo: manual.memo }),
    })
    previous = entry.value
    return row
  })
}
