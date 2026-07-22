/**
 * プライバシー 3 段階を取引リストに適用するヘルパ。
 * Query レイヤから呼ばれる唯一のプライバシー判定ポイント。
 *
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.5
 *
 * ルール（OQ-47: プライバシー3段階は Query/API 層で完全強制する。UI マスキングへ委譲しない）:
 *  1. 世帯（household）: 両者に明細・合計とも可視
 *  2. 個人(本人)（personal_honey/darling）: 本人には明細をリスト表示、配偶者には
 *     合計のみ（個人合計として別途集計で提供）。配偶者の取引一覧からは明細行を完全除外する
 *     （日付・カテゴリ・件数も見せない。伏せ字行は残さない）
 *  3. 経費(会社)（business_expense）: 本人のみ明細・合計可視、配偶者には一切不可視（行も除外）
 *  4. 未分類: 08c F-1 個人別、所有者本人のみリスト可視
 *  5. 削除済み: リストから常に除外
 */
import type {
  Transaction,
  ClassifiedTransaction,
  UnclassifiedTransaction,
} from '../aggregates/Transaction'
import type { ViewerContext } from './ViewerContext'
import type { TransactionListItem } from '../queries/views/TransactionListItem'

/**
 * 分類済み取引を明細としてリスト掲載してよいか。
 * 世帯は両者に可視、個人(本人)・経費(会社)は所有者本人のみ可視（配偶者には行ごと不可視）。
 */
export function isVisibleAsDetail(tx: ClassifiedTransaction, viewer: ViewerContext): boolean {
  if (tx.details.expenseClass === 'household') return true
  return tx.common.ownerUserId === viewer.viewerId
}

export function toListItems(
  txs: Transaction[],
  viewer: ViewerContext,
  categoryNames: Map<string, string>,
): TransactionListItem[] {
  return txs
    .filter((tx): tx is UnclassifiedTransaction | ClassifiedTransaction => {
      if (tx.kind === 'deleted') return false
      // 未分類は所有者本人のみ（F-1）
      if (tx.kind === 'unclassified') return tx.common.ownerUserId === viewer.viewerId
      // 分類済み: 可視でない行（配偶者の個人・経費）は完全除外する
      return isVisibleAsDetail(tx, viewer)
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
      // classified かつ可視な行のみが残る（filter 済み）。可視行は明細を常にフル表示する
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
