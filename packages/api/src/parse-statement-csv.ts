/**
 * 明細 CSV のパース（取込 API 用）
 *
 * 期待フォーマット: 1 行 = `日付,店名,金額`（ヘッダー行は任意、UTF-8）。
 *  - 日付: YYYY/MM/DD または YYYY-MM-DD（JST 暦日として UTC 深夜 0 時の Date に変換）
 *  - 金額: 整数（桁区切りカンマ・引用符は許容、0 は不正）
 * フォーマット不備は行番号（物理行、1 始まり）付きのエラーとして返し、
 * ジョブを format_validation_failed へ遷移させる。
 */

export interface StatementCsvRow {
  /** 元 CSV の物理行番号（1 始まり、ヘッダー行を含む通し番号） */
  rowNumber: number
  occurredAt: Date
  merchantName: string
  amount: number
}

export type StatementCsvParseResult =
  | { ok: true; rows: StatementCsvRow[] }
  | { ok: false; error: string }

const DATE_REGEX = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/

/** 引用符が閉じていない行は null を返す */
function splitCsvLine(line: string): string[] | null {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (inQuotes) return null
  fields.push(current)
  return fields
}

function parseDate(raw: string): Date | null {
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

function parseAmount(raw: string): number | null {
  const normalized = raw.trim().replace(/,/g, '').replace(/^¥/, '')
  if (!/^-?\d+$/.test(normalized)) return null
  return Number(normalized)
}

export function parseStatementCsv(content: string): StatementCsvParseResult {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0)

  if (lines.length === 0) {
    return { ok: false, error: 'CSV が空である' }
  }

  const first = lines[0]
  if (first === undefined) {
    return { ok: false, error: 'CSV が空である' }
  }
  const firstFields = splitCsvLine(first.line)
  if (firstFields === null) {
    return { ok: false, error: `${first.lineNumber} 行目: 引用符が閉じていない` }
  }
  // 先頭行の第 1 フィールドが日付でなければヘッダー行として読み飛ばす
  const startIndex = parseDate(firstFields[0] ?? '') === null ? 1 : 0
  const dataLines = lines.slice(startIndex)
  if (dataLines.length === 0) {
    return { ok: false, error: 'データ行が存在しない（ヘッダー行のみ）' }
  }

  const rows: StatementCsvRow[] = []
  for (const { line, lineNumber } of dataLines) {
    const fields = splitCsvLine(line)
    if (fields === null) {
      return { ok: false, error: `${lineNumber} 行目: 引用符が閉じていない` }
    }
    if (fields.length < 3) {
      return { ok: false, error: `${lineNumber} 行目: 列数が不足している（日付,店名,金額 が必要）` }
    }
    const occurredAt = parseDate(fields[0] ?? '')
    if (occurredAt === null) {
      return { ok: false, error: `${lineNumber} 行目: 日付が不正である: ${fields[0] ?? ''}` }
    }
    const merchantName = (fields[1] ?? '').normalize('NFKC').trim()
    if (merchantName.length === 0) {
      return { ok: false, error: `${lineNumber} 行目: 店名が空である` }
    }
    const amount = parseAmount(fields[2] ?? '')
    if (amount === null || amount === 0) {
      return { ok: false, error: `${lineNumber} 行目: 金額が不正である: ${fields[2] ?? ''}` }
    }
    rows.push({ rowNumber: lineNumber, occurredAt, merchantName, amount })
  }
  return { ok: true, rows }
}
