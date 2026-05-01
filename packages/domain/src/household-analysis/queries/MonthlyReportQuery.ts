import type { UserId, MonthlyReportId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { MonthlyReportView } from './views/MonthlyReportView'

export interface MonthlyReportQuery {
  fetchByMonth(viewerId: UserId, month: YearMonth): Promise<MonthlyReportView | null>
  fetchById(viewerId: UserId, id: MonthlyReportId): Promise<MonthlyReportView | null>
}
