export function formatMoney(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`
}
