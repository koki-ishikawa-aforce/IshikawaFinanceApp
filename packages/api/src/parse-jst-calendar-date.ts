/**
 * JST 暦日文字列 → UTC 深夜 0 時の Date への変換（取込経路共通の規約、OQ-23）
 *
 * 「発生日時 = JST 暦日を UTC 深夜 0 時で表現する」という取込側の日付規約は、
 * CSV パース（parse-statement-csv）と PDF→CSV 変換（AnthropicPdfToCsvConverter）の
 * 双方で同一でなければならない（三項一致の重複除外が同じ発生日時表現に依存するため）。
 * 規約が二重実装で drift しないよう、ここに一元化する。
 *
 * 受理形式: `YYYY/MM/DD` または `YYYY-MM-DD`。2/30 等の繰り上がりは不正として null を返す。
 */
const DATE_REGEX = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/

export function parseJstCalendarDate(raw: string): Date | null {
  const m = DATE_REGEX.exec(raw.trim())
  if (m === null) return null
  const [, y, mo, d] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const date = new Date(Date.UTC(year, month - 1, day))
  // 2/30 等の繰り上がりを不正とする
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}
