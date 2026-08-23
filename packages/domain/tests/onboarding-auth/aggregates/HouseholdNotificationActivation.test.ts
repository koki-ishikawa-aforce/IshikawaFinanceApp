import { describe, it, expect } from 'vitest'
import {
  HouseholdNotificationActivationSchema,
  NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION,
  isHouseholdNotificationActivated,
  recordHouseholdNotificationActivated,
} from '../../../src/onboarding-auth/aggregates/HouseholdNotificationActivation'

describe('世帯通知有効化記録（世帯レベル、#447）', () => {
  const AT = new Date('2026-03-01T09:00:00Z')

  it('未有効化からの記録で有効化済みへ遷移する', () => {
    const activated = recordHouseholdNotificationActivated(NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION, AT)
    expect(activated).toEqual({ kind: 'activated', activatedAt: AT })
  })

  it('再記録は冪等（有効化日時を上書きしない）', () => {
    // 有効化日時はテストメッセージ配信の冪等性キーの一部。書き換わると同じメッセージが再び届く
    const activated = recordHouseholdNotificationActivated(NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION, AT)
    const again = recordHouseholdNotificationActivated(activated, new Date('2026-03-02T09:00:00Z'))
    expect(again).toBe(activated)
    expect(again.activatedAt).toEqual(AT)
  })

  it('未有効化は「まだ依頼していない」を表す（発行済みとみなさない）', () => {
    expect(isHouseholdNotificationActivated(NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION)).toBe(false)
    expect(
      isHouseholdNotificationActivated(
        recordHouseholdNotificationActivated(NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION, AT),
      ),
    ).toBe(true)
  })

  it('未有効化は既定値と一致し、未知の状態は受け付けない', () => {
    // Repository は「行が無い」ときに定数をそのまま返すため、定義がずれても気づけない
    expect(HouseholdNotificationActivationSchema.parse({ kind: 'not_activated' })).toEqual(
      NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION,
    )
    expect(() => HouseholdNotificationActivationSchema.parse({ kind: 'deactivated' })).toThrow()
  })

  it('有効化済みは有効化日時を必須とする', () => {
    expect(() => HouseholdNotificationActivationSchema.parse({ kind: 'activated' })).toThrow()
    expect(() =>
      HouseholdNotificationActivationSchema.parse({
        kind: 'activated',
        activatedAt: '2026-03-01T09:00:00Z',
      }),
    ).toThrow()
  })
})
