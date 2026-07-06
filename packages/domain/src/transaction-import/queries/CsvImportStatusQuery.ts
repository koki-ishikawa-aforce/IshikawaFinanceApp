/**
 * CSV 取込状態 Query I/F
 * @see docs/domain/08a-ul-取引取込.md §2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * 対象月の CSV 取込が完了していなければ null を返す。
 */
import type { UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { CsvImportCompletionView } from './views/CsvImportCompletionView'

export interface CsvImportStatusQuery {
  fetchCompletion(userId: UserId, targetMonth: YearMonth): Promise<CsvImportCompletionView | null>
}
