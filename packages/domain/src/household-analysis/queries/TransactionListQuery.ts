import type { UserId, TransactionId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { ExpenseClass } from '../../shared/value-objects/ExpenseClass'
import type { TransactionListItem } from './views/TransactionListItem'

export interface TransactionListFilter {
  month: YearMonth
  expenseClass?: ExpenseClass
  isUnclassifiedOnly?: boolean
}

export interface UnclassifiedSummary {
  count: number
  recentIds: TransactionId[]
}

export interface TransactionListQuery {
  fetch(viewerId: UserId, filter: TransactionListFilter): Promise<TransactionListItem[]>
  fetchUnclassifiedSummary(viewerId: UserId, month: YearMonth): Promise<UnclassifiedSummary>
}
