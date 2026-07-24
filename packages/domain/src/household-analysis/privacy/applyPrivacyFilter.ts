/**
 * プライバシー 3 段階を取引リストに適用するヘルパ。
 * Query レイヤから呼ばれる唯一のプライバシー判定ポイント。
 *
 * @see docs/domain/01-overview.md L152-155（プライバシー3段階）
 * @see docs/domain/08c-ul-家計分析.md §6.3
 *
 * プライバシーは Query/API 層で完全強制する。Static Export / LIFF 構成では
 * UI 層マスキングがセキュリティ境界にならないため、配偶者に見せてはいけない
 * 取引はリスト自体から除外する（伏せ字行として残さない）。個人・経費の
 * 「相手には合計のみ」はダッシュボード / 月次レポートの集計値が別途担う。
 *
 * ルール:
 *  1. 世帯（household）: 両者に明細可視
 *  2. 個人(本人)（personal_honey/darling）: 所有者本人のみリスト掲載（配偶者は明細不可視、合計は集計値で可視）
 *  3. 経費(会社)（business_expense）: 所有者本人のみリスト掲載（配偶者は合計も不可視）
 *  4. 未分類: 08c F-1 個人別、所有者本人のみリスト掲載
 *  5. 削除済み: リストから常に除外
 */
import type {
  Transaction,
  UnclassifiedTransaction,
  ClassifiedTransaction,
} from '../aggregates/Transaction'
import type { ViewerContext } from './ViewerContext'
import type { TransactionListItem } from '../queries/views/TransactionListItem'

/**
 * 取引一覧に載せてよいか（プライバシー完全強制）。
 * 世帯取引のみ両者可視、それ以外（個人・経費・未分類）は所有者本人のみ。
 * 削除済みは常に不可視。ここを通過した行は明細（加盟店名・金額）を必ず出してよい。
 */
function isListVisible(
  tx: Transaction,
  viewer: ViewerContext,
): tx is UnclassifiedTransaction | ClassifiedTransaction {
  if (tx.kind === 'deleted') return false
  if (tx.kind === 'classified' && tx.details.expenseClass === 'household') return true
  return tx.common.ownerUserId === viewer.viewerId
}

export function toListItems(
  txs: Transaction[],
  viewer: ViewerContext,
  categoryNames: Map<string, string>,
): TransactionListItem[] {
  return txs
    .filter(tx => isListVisible(tx, viewer))
    .map(tx => {
      if (tx.kind === 'unclassified') {
        return {
          transactionId: tx.common.transactionId,
          occurredAt: tx.common.occurredAt,
          expenseClass: tx.defaultExpenseClass,
          categoryId: null,
          categoryName: null,
          merchantName: tx.common.merchantName,
          amount: tx.common.amount,
          isUnclassified: true,
        }
      }
      // classified（deleted は isListVisible で除外済み、unclassified は上で return 済み）。
      // 到達する行は世帯取引か本人所有の取引のみなので、明細は常に可視。
      return {
        transactionId: tx.common.transactionId,
        occurredAt: tx.common.occurredAt,
        expenseClass: tx.details.expenseClass,
        categoryId: tx.details.categoryId,
        categoryName: categoryNames.get(tx.details.categoryId) ?? null,
        merchantName: tx.common.merchantName,
        amount: tx.common.amount,
        isUnclassified: false,
      }
    })
}
