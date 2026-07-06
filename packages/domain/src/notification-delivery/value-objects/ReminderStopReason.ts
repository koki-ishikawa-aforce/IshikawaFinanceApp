import { z } from 'zod'

/**
 * リマインダー停止理由
 * @see docs/domain/08g-ul-通知配信.md §2
 */
export const ReminderStopReasonSchema = z.enum(['csv_import_completed', 'notification_disabled'])
export type ReminderStopReason = z.infer<typeof ReminderStopReasonSchema>
