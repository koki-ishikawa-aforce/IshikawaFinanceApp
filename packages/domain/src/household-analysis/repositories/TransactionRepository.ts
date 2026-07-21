/**
 * 取引集約の永続化 I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.3
 *
 * Phase 4 では interface 定義のみ。実装は Phase 5 以降の adapter 層。
 */
import type { CategoryId, ExpenseTypeId, TransactionId, UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { ClassifiedTransaction, Transaction } from '../aggregates/Transaction'

export interface TransactionRepository {
  /** ID で取引を取得。見つからなければ null。 */
  findById(id: TransactionId): Promise<Transaction | null>

  /** 指定ユーザーの指定月の全取引を取得（プライバシー適用なし、Read 側で適用する） */
  findByMonth(ownerId: UserId, month: YearMonth): Promise<Transaction[]>

  /** 対象カテゴリに分類済みの全取引（カテゴリ削除リマップ用。ユーザー横断で漏れなく返す） */
  findClassifiedByCategory(categoryId: CategoryId): Promise<ClassifiedTransaction[]>

  /** 対象経費種別に分類済みの全取引（経費種別削除リマップ用。ユーザー横断で漏れなく返す） */
  findClassifiedByExpenseType(expenseTypeId: ExpenseTypeId): Promise<ClassifiedTransaction[]>

  /** 取引を保存（新規・更新両対応、状態遷移後の集約をそのまま渡す） */
  save(transaction: Transaction): Promise<void>
}
