/**
 * 金額の表記(`docs/design/usability.md` 5-3)。3 桁区切り + 「円」で統一する。
 *
 * `¥` と `円` を画面ごとに使い分けない。負値も同じ形（`-5,000円`）で出す
 */
export function formatMoney(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`
}
