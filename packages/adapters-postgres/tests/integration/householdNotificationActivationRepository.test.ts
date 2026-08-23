import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION,
  recordHouseholdNotificationActivated,
} from '@warimaru/domain'
import { db } from './setup'
import { PostgresHouseholdNotificationActivationRepository } from '../../src/onboarding-auth/PostgresHouseholdNotificationActivationRepository'
import { householdNotificationActivations } from '../../src/schema'

const repo = new PostgresHouseholdNotificationActivationRepository(db)

const AT = new Date('2026-03-01T09:00:00.000Z')

describe('PostgresHouseholdNotificationActivationRepository', () => {
  it('記録が無ければ未有効化を返す（テスト送信をまだ依頼していない）', async () => {
    expect(await repo.find()).toEqual(NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION)
  })

  it('save → find の往復同一性（有効化済み）', async () => {
    const activated = recordHouseholdNotificationActivated(NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION, AT)
    await repo.save(activated)
    expect(await repo.find()).toEqual(activated)
  })

  it('別の有効化日時で再 save しても最初の記録を保つ（世帯で 1 件・上書きしない）', async () => {
    // 有効化日時は配信の冪等性キーの一部。後から書き換わると同じテストメッセージが再び届く
    await repo.save(recordHouseholdNotificationActivated(NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION, AT))
    await repo.save({ kind: 'activated', activatedAt: new Date('2026-03-05T09:00:00.000Z') })

    expect(await repo.find()).toEqual({ kind: 'activated', activatedAt: AT })
    const rows = await db.select().from(householdNotificationActivations)
    expect(rows).toHaveLength(1)
  })

  it('singleton = false の 2 行目は CHECK 違反（23514）', async () => {
    // CHECK が落ちると 2 行目が成立し、find() の limit(1) がどちらを返すか不定になる
    // （「有効化済みか」の唯一の根拠が不定になる）
    const inserted = db.execute(
      sql`INSERT INTO household_notification_activations (singleton, activated_at)
          VALUES (false, now())`,
    )
    let code: string | undefined
    try {
      await inserted
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } }
      code = err.cause?.code ?? err.code
    }
    expect(code).toBe('23514')
  })
})
