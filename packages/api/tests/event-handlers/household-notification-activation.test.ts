/**
 * 世帯通知有効化記録の確定（#590）のハンドラー単体テスト。
 * TestMessageSent を直接発行し、記録の書き込みタイミングと冪等性・失敗時の扱いを固定する。
 */
import { describe, it, expect, vi } from 'vitest'
import type { HouseholdNotificationActivationRepository, TestMessageSent } from '@warimaru/domain'
import {
  InMemoryEventBus,
  NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION,
  TalkRoomIdSchema,
  TestMessageSentSchema,
  DeliveryMessageIdSchema,
} from '@warimaru/domain'
import { registerHouseholdNotificationActivationEventHandlers } from '../../src/event-handlers/household-notification-activation.js'
import { domainEventBase } from '../../src/event-handlers/event-base.js'
import { createMockHouseholdNotificationActivationRepository } from '../../src/mock-repositories.js'

const AT = new Date('2026-03-01T09:00:00Z')
const TALK_ROOM_ID = TalkRoomIdSchema.parse('room_test_001')

function testMessageSent(activatedAt: Date): TestMessageSent {
  return TestMessageSentSchema.parse({
    ...domainEventBase(),
    type: 'TestMessageSent',
    deliveryMessageId: DeliveryMessageIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    talkRoomId: TALK_ROOM_ID,
    activatedAt,
  })
}

function setup(
  repository: HouseholdNotificationActivationRepository = createMockHouseholdNotificationActivationRepository(),
): { eventBus: InMemoryEventBus; repository: HouseholdNotificationActivationRepository } {
  const eventBus = new InMemoryEventBus()
  registerHouseholdNotificationActivationEventHandlers(eventBus, {
    householdNotificationActivationRepository: repository,
  })
  return { eventBus, repository }
}

describe('registerHouseholdNotificationActivationEventHandlers', () => {
  it('TestMessageSent を受けて世帯通知有効化記録を書く', async () => {
    const { eventBus, repository } = setup()
    expect(await repository.find()).toEqual(NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION)

    await eventBus.publish(testMessageSent(AT))

    expect(await repository.find()).toEqual({ kind: 'activated', activatedAt: AT })
  })

  it('既に有効化済みなら上書きしない（冪等。同一配信確定の再発行に備える）', async () => {
    const { eventBus, repository } = setup()
    await eventBus.publish(testMessageSent(AT))

    // 別の日時で再発行されても、最初に記録した日時のまま
    await eventBus.publish(testMessageSent(new Date('2026-03-02T09:00:00Z')))

    expect(await repository.find()).toEqual({ kind: 'activated', activatedAt: AT })
  })

  it('保存に失敗しても例外を外へ伝播させない（safeSubscribe が受け止める）', async () => {
    const repository = createMockHouseholdNotificationActivationRepository()
    repository.save = (): Promise<void> => Promise.reject(new Error('save failed'))
    const { eventBus } = setup(repository)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(eventBus.publish(testMessageSent(AT))).resolves.toBeUndefined()
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('TestMessageSent'),
        expect.any(Error),
      )
    } finally {
      logged.mockRestore()
    }
  })
})
