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
