import { describe, it, expect } from 'vitest'
import { parseStatementCsv } from '../src/parse-statement-csv.js'

function okRows(content: string) {
  const result = parseStatementCsv(content)
  if (!result.ok) throw new Error(`パース失敗: ${result.error}`)
  return result.rows
}

function errorOf(content: string): string {
  const result = parseStatementCsv(content)
  if (result.ok) throw new Error('エラーを期待したがパース成功した')
  return result.error
}

describe('parseStatementCsv', () => {
  it('基本形式（日付,店名,金額）をパースできる', () => {
    const rows = okRows('2026/07/05,スーパーA,1200\n2026-07-06,コンビニB,-300')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ merchantName: 'スーパーA', amount: 1200 })
    expect(rows[0]?.occurredAt).toEqual(new Date(Date.UTC(2026, 6, 5)))
    expect(rows[1]?.amount).toBe(-300)
  })

  it('rowNumber は物理行番号（1 始まり）', () => {
    const rows = okRows('2026/07/05,スーパーA,1200\n2026/07/06,コンビニB,300')
    expect(rows.map(r => r.rowNumber)).toEqual([1, 2])
  })

  it('ヘッダー行はスキップされ rowNumber はヘッダーを含む通し番号', () => {
    const rows = okRows('日付,店名,金額\n2026/07/05,スーパーA,1200')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.rowNumber).toBe(2)
  })

  it('BOM 付き・引用符・桁区切りカンマ・¥ を処理できる', () => {
    const rows = okRows('\uFEFF2026/07/05,"スーパー ""本店""","¥1,200"')
    expect(rows[0]?.merchantName).toBe('スーパー "本店"')
    expect(rows[0]?.amount).toBe(1200)
  })

  it('店名は NFKC 正規化される', () => {
    const rows = okRows('2026/07/05,ｽｰﾊﾟｰＡ,100')
    expect(rows[0]?.merchantName).toBe('スーパーA')
  })

  it('空ファイル・ヘッダーのみはエラー', () => {
    expect(errorOf('')).toContain('空')
    expect(errorOf('日付,店名,金額')).toContain('ヘッダー行のみ')
  })

  it('2/30 等の存在しない日付はエラー', () => {
    // 先頭行の日付不正はヘッダー扱いになるため、データ行（2 行目）で検証する
    expect(errorOf('2026/07/01,スーパーA,100\n2026/02/30,スーパーA,100')).toContain('日付が不正')
  })

  it('金額 0・非数値はエラー', () => {
    expect(errorOf('2026/07/05,スーパーA,0')).toContain('金額が不正')
    expect(errorOf('2026/07/05,スーパーA,abc')).toContain('金額が不正')
  })

  it('列数不足・空店名はエラー', () => {
    expect(errorOf('2026/07/05,スーパーA')).toContain('列数が不足')
    expect(errorOf('2026/07/05, ,100')).toContain('店名が空')
  })

  it('引用符が閉じていない行はエラー（行番号付き）', () => {
    expect(errorOf('2026/07/05,スーパーA,100\n2026/07/06,"閉じない店,200')).toContain(
      '2 行目: 引用符が閉じていない',
    )
  })

  it('ヘッダー行の引用符不整合もエラー', () => {
    expect(errorOf('"日付,店名,金額\n2026/07/05,スーパーA,100')).toContain('引用符が閉じていない')
  })
})
