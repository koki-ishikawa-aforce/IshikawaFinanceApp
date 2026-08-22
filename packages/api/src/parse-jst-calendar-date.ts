/**
 * JST 暦日文字列 → UTC 深夜 0 時の Date への変換（取込経路共通の規約、OQ-23）
 *
 * 「発生日時 = JST 暦日を UTC 深夜 0 時で表現する」という取込側の日付規約は、
 * CSV パース（parse-statement-csv）と PDF→CSV 変換（AnthropicPdfToCsvConverter）の
 * 双方で同一でなければならない（三項一致の重複除外が同じ発生日時表現に依存するため）。
 * 規約が二重実装で drift しないよう、ここに一元化する。
 *
 * 受理形式: `YYYY/MM/DD` または `YYYY-MM-DD`。2/30 等の繰り上がりは不正として null を返す。
 *
 * 暦日 → `Date` の変換そのものはドメイン（`utcMidnightOfJstCalendarDate`）に置いてある。
 * メール取込のパース（08a §2）も同じ規約で発生日を作るため、日付表現を層ごとに実装しない。
 * ここに残るのは「文字列の受理形式」だけ。
 */
import { utcMidnightOfJstCalendarDate } from '@warimaru/domain'

const DATE_REGEX = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/

export function parseJstCalendarDate(raw: string): Date | null {
  const m = DATE_REGEX.exec(raw.trim())
  if (m === null) return null
  const [, y, mo, d] = m
  return utcMidnightOfJstCalendarDate(Number(y), Number(mo), Number(d))
}
