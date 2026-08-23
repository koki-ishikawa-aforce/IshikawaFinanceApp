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
    await this.db
      .insert(householdNotificationActivations)
      .values({ activatedAt: activation.activatedAt })
      .onConflictDoNothing({ target: householdNotificationActivations.singleton })
  }
}
