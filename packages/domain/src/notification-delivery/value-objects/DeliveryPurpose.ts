import { z } from 'zod'

/**
 * 配信用途
 * @see docs/domain/08g-ul-通知配信.md §1
 */
export const DeliveryPurposeSchema = z.enum([
  'csv_import_reminder',
  'monthly_report_household_summary',
  'monthly_report_personal_summary',
  'oauth_revocation_notice',
  'test_message',
])
export type DeliveryPurpose = z.infer<typeof DeliveryPurposeSchema>
