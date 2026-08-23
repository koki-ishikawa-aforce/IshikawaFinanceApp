/**
 * HouseholdNotificationActivationRepository の PostgreSQL 実装（世帯で 1 件、#447）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1 §2
 *
 * 行が無い = 未有効化。記録は singleton カラム（PK + CHECK）の競合で握り潰す
 * （`onConflictDoNothing`）— 有効化日時は配信の冪等性キーの一部であり、後から書き換えると
 * 同じテストメッセージが二重に届く。上書きしないことでその余地を DB 側にも残さない。
 */
import type {
  ActivatedHouseholdNotification,
  HouseholdNotificationActivation,
  HouseholdNotificationActivationRepository,
} from '@warimaru/domain'
import {
  HouseholdNotificationActivationSchema,
  NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION,
} from '@warimaru/domain'
import type { Db } from '../client'
import { householdNotificationActivations } from '../schema'

export class PostgresHouseholdNotificationActivationRepository implements HouseholdNotificationActivationRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<HouseholdNotificationActivation> {
    // singleton PK により 0..1 行
    const rows = await this.db
      .select({ activatedAt: householdNotificationActivations.activatedAt })
      .from(householdNotificationActivations)
      .limit(1)
    const row = rows[0]
    if (row === undefined) return NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION
    return HouseholdNotificationActivationSchema.parse({
      kind: 'activated',
      activatedAt: row.activatedAt,
    })
  }

  async save(activation: ActivatedHouseholdNotification): Promise<void> {
    const inserted = await this.db
      .insert(householdNotificationActivations)
      .values({ activatedAt: activation.activatedAt })
      .onConflictDoNothing({ target: householdNotificationActivations.singleton })
      .returning({ activatedAt: householdNotificationActivations.activatedAt })
    if (inserted.length > 0) return

    // 競合して捨てた側の有効化日時が既存と違う場合だけ記録する。発火の起点は 4 つあり、
    // 同時に走った 2 つが別の有効化日時でイベントを発行すると配信側の冪等性キーもずれるため、
    // テストメッセージが 2 通届いた事実が記録上たどれなくなる（日時のみで PII は含まない）
    const current = await this.find()
    if (
      current.kind === 'activated' &&
      current.activatedAt.getTime() !== activation.activatedAt.getTime()
    ) {
      console.warn(
        `[onboarding] 世帯の通知機能有効化の記録が競合した（既存=${current.activatedAt.toISOString()}, ` +
          `要求=${activation.activatedAt.toISOString()}）— 既存を正とする。` +
          '別の有効化日時で発行された回はテストメッセージが二重に届いている可能性がある',
      )
    }
  }
}
