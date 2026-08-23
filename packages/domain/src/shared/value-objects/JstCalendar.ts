/**
 * JST 暦日の部品化（コンテキスト横断の共有規約）
 *
 * 本アプリの日付条件（通知の「当月 5 日以降」08g §2、入金用途判別の「月内基準日」08d §1）は
 * いずれも利用者から見た JST の暦日で書かれている。`Date` は UTC 基準のため、UTC のまま
 * 日を読むと JST 深夜帯（00:00〜09:00 JST）で 1 日ずれる。日付規約が呼出し側ごとに
 * 割れないよう、変換をここに一元化する。
 *
 * 元は 08g（通知配信）の値オブジェクト内に置いていたが、08d（残高・資産推移管理）の
 * 入金用途判別でも必要になったため shared へ移した。コンテキスト間の直接依存を作らない。
 */
import { YearMonthSchema, type YearMonth } from './YearMonth'

/** JST は UTC+9 固定（サマータイムが無いためオフセットで表現できる） */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** JST の暦日（年・月・日）。`Date` は UTC 基準のため +9h してから UTC 部品を読む。 */
export function jstCalendarParts(at: Date): { year: number; month: number; day: number } {
  const jst = new Date(at.getTime() + JST_OFFSET_MS)
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() }
}

/** JST 暦日の年月（"YYYY-MM"）。対象月との一致判定に使う */
export function jstYearMonthOf(at: Date): YearMonth {
  const { year, month } = jstCalendarParts(at)
  return YearMonthSchema.parse(`${year}-${String(month).padStart(2, '0')}`)
}

/**
 * JST 暦月の開始時刻（その月の 1 日 00:00 JST）を指す `Date`。
 *
 * 発生日時で月を切り出す用途（残高変動履歴の月範囲読み出し、#398）に使う。
 * `jstYearMonthOf` と同じ JST 基準で境界を引くので、「この瞬間が属する月」と
 * 「この月の範囲」が食い違わない。
 */
export function jstMonthStart(ym: YearMonth): Date {
  const [year, month] = ym.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(year, month - 1, 1) - JST_OFFSET_MS)
}

/**
 * 翌 JST 暦月の開始時刻。月範囲の上端として「未満」で使う
 * （月末の最終ミリ秒を意識せずに済み、境界の点が隣の月へ二重に入らない）。
 */
export function jstNextMonthStart(ym: YearMonth): Date {
  const [year, month] = ym.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS)
}

/**
 * JST 暦日（年・月・日）→ 取込側の発生日表現（UTC 深夜 0 時の `Date`）。
 *
 * 時刻を持たない取込元（CSV の計上日、振込入金のお知らせの入金日、引落予定日）は
 * この表現に揃える。UTC 深夜 0 時は JST の同日 09:00 に当たるので、`jstCalendarParts` で
 * 読み戻したときに元の暦日へ戻る。取込経路ごとに表現が割れると、発生日を突き合わせる
 * 重複除外（三項一致、OQ-7 / OQ-23）が成立しない。
 *
 * 2 月 30 日のような実在しない日付は繰り上がりを許さず `null` を返す（外部入力である
 * メール本文・CSV から来るため、黙って別の日に化けさせない）。
 */
export function utcMidnightOfJstCalendarDate(
  year: number,
  month: number,
  day: number,
): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

/**
 * JST の日時（分単位）→ その瞬間を指す `Date`。
 *
 * 時刻まで分かる取込元（カード利用通知の「利用日」）に使う。暦日だけの取込元と違い、
 * 時刻を捨てずに実時刻として持つ（JST 暦日は `jstCalendarParts` で導出できるため、
 * 発生日での突合には影響しない）。実在しない日時は `null` を返す。
 */
export function utcInstantOfJstDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  const inRange = (value: number, max: number): boolean =>
    Number.isInteger(value) && value >= 0 && value <= max
  if (!inRange(hour, 23) || !inRange(minute, 59)) return null
  const midnight = utcMidnightOfJstCalendarDate(year, month, day)
  if (midnight === null) return null
  return new Date(midnight.getTime() + (hour * 60 + minute) * 60 * 1000 - JST_OFFSET_MS)
}
