/**
 * プライバシー 3 段階を取引リストに適用するヘルパ。
 * Query レイヤから呼ばれる唯一のプライバシー判定ポイント。
 *
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.5
 *
 * ルール:
 *  1. 世帯（household）: 両者に明細・合計とも可視
 *  2. 個人(本人)（personal_honey/darling）: 本人には明細・合計、配偶者には合計のみ可視
 *  3. 経費(会社)（business_expense）: 本人のみ明細・合計可視、配偶者には一切不可視
 *  4. 未分類: 08c F-1 個人別、所有者本人のみリスト可視
 *  5. 削除済み: リストから常に除外
 */
import type {
  Transaction,
  ClassifiedTransaction,
} from '../aggregates/Transaction'
import type { ViewerContext } from './ViewerContext'
import type { TransactionListItem } from '../queries/views/TransactionListItem'

export function isVisibleAsDetail(tx: ClassifiedTransaction, viewer: ViewerContext): boolean {
  const ec = tx.details.expenseClass
  if (ec === 'household') return true
  if (ec === 'business_expense') return tx.common.ownerUserId === viewer.viewerId
  return tx.common.ownerUserId === viewer.viewerId
}

export function isVisibleAsAggregate(tx: ClassifiedTransaction, viewer: ViewerContext): boolean {
  const ec = tx.details.expenseClass
  if (ec === 'household') return true
  if (ec === 'business_expense') return tx.common.ownerUserId === viewer.viewerId
  return true
}

export function toListItems(
  txs: Transaction[],
  viewer: ViewerContext,
  categoryNames: Map<string, string>,
): TransactionListItem[] {
  return txs
    .filter(tx => tx.kind !== 'deleted')
    .filter(tx => {
      if (tx.kind === 'unclassified') {
        return tx.common.ownerUserId === viewer.viewerId
      }
      if (tx.kind === 'classified' && tx.details.expenseClass === 'business_expense') {
        return tx.common.ownerUserId === viewer.viewerId
      }
      return true
    })
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
      // classified（filter で deleted は除外済み、unclassified は上の if で return 済み）
      const detailVisible = isVisibleAsDetail(tx, viewer)
      return {
        transactionId: tx.common.transactionId,
        occurredAt: tx.common.occurredAt,
        expenseClass: tx.details.expenseClass,
        categoryId: tx.details.categoryId,
        categoryName: categoryNames.get(tx.details.categoryId) ?? null,
        merchantName: detailVisible ? tx.common.merchantName : null,
        amount: detailVisible ? tx.common.amount : null,
        isUnclassified: false,
      }
    })
}
