/**
 * 世帯通知有効化記録 Repository I/F（世帯レベル・シングルトン、#447）
 *
 * 世帯にひとつの記録のため識別子を取らない。
 *
 * `find` は `SharedTalkRoomRepository` と同じく null を返さない。「記録が無い」＝「未有効化」で
 * あり、ドメインに `not_activated` という有効な状態が存在するためである。
 * `save` は有効化済みのみを受け取る（有効化の取り消しは要件に無い）。
 */
import type {
  ActivatedHouseholdNotification,
  HouseholdNotificationActivation,
} from '../aggregates/HouseholdNotificationActivation'

export interface HouseholdNotificationActivationRepository {
  find(): Promise<HouseholdNotificationActivation>
  save(activation: ActivatedHouseholdNotification): Promise<void>
}
