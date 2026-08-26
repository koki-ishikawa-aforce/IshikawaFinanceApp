/**
 * 通知配信コンテキストのイベントハンドラー（#36）の単体テスト。
 * NotificationActivated → テストメッセージ配信 → TestMessageSent の発行条件を直接固定する。
 * #590: TestMessageSent は `sent` だけでなく `already_delivered`（冪等スキップ）でも
 * 発行されるようになった。世帯通知有効化記録（household-notification-activation.ts）が
 * この発行を「配信確定」の唯一の合図にするため、条件・伝播するフィールドの両方を固定する。
 */
import { describe, it, expect } from 'vitest'
import type {
  DeliveryTarget,
  DomainEvent,
  LineMessagingGateway,
  LinePushResult,
} from '@warimaru/domain'
import {
  InMemoryEventBus,
  LineMessageIdSchema,
  NotificationActivatedSchema,
  TalkRoomIdSchema,
} from '@warimaru/domain'
import type { TestMessageSent } from '@warimaru/domain'
import { registerNotificationDeliveryEventHandlers } from '../../src/event-handlers/notification-delivery.js'
import { domainEventBase } from '../../src/event-handlers/event-base.js'
import { createNotificationDeliveryService } from '../../src/notification/delivery-service.js'
import {
  createMockConsecutiveFailureCounterRepository,
  createMockDeliveryMessageRepository,
  createMockFailsafeEmailRepository,
  createMockLineDeliveryLogRepository,
} from '../../src/mock-repositories.js'

const TALK_ROOM_ID = TalkRoomIdSchema.parse('room_test_001')
const ACTIVATED_AT = new Date('2026-03-01T09:00:00Z')

const success: LinePushResult = {
  kind: 'success',
  lineMessageId: LineMessageIdSchema.parse('line-msg-1'),
}
const failure: LinePushResult = {
  kind: 'failure',
  failureReason: 'invalid_target',
  detail: 'stub invalid target',
}

/** 応答列を順に返すスタブ LINE ゲートウェイ */
function stubLineGateway(results: LinePushResult[]): LineMessagingGateway {
  let calls = 0
  return {
    sendPush(_target: DeliveryTarget, _content) {
      const result = results[Math.min(calls, results.length - 1)]
      calls += 1
      if (result === undefined) throw new Error('スタブ応答が未定義')
      return Promise.resolve({ sentPayloadJson: '{"stub":true}', result })
    },
  }
}

function activatedEvent(activatedAt: Date) {
  return NotificationActivatedSchema.parse({
    ...domainEventBase(),
    type: 'NotificationActivated',
    talkRoomId: TALK_ROOM_ID,
    activatedAt,
  })
}

function setup(lineGateway: LineMessagingGateway) {
  const eventBus = new InMemoryEventBus()
  const testMessageSent: TestMessageSent[] = []
  eventBus.subscribe<TestMessageSent>('TestMessageSent', e => {
    testMessageSent.push(e)
    return Promise.resolve()
  })
  const events: DomainEvent[] = []
  eventBus.subscribe('DeliveryLogSaved', e => {
    events.push(e)
    return Promise.resolve()
  })

  const notificationDeliveryService = createNotificationDeliveryService({
    deliveryMessageRepository: createMockDeliveryMessageRepository(),
    lineDeliveryLogRepository: createMockLineDeliveryLogRepository(),
    consecutiveFailureCounterRepository: createMockConsecutiveFailureCounterRepository(),
    failsafeEmailRepository: createMockFailsafeEmailRepository(),
    lineMessagingGateway: lineGateway,
    failsafeEmailGateway: { send: () => Promise.reject(new Error('未使用')) },
    eventBus,
    failsafeEmailRecipients: [],
  })
  registerNotificationDeliveryEventHandlers(eventBus, { notificationDeliveryService })

  return { eventBus, testMessageSent }
}

describe('registerNotificationDeliveryEventHandlers', () => {
  it('sent（実送信）で TestMessageSent を発行し、フィールドを正しく伝播する', async () => {
    const { eventBus, testMessageSent } = setup(stubLineGateway([success]))

    await eventBus.publish(activatedEvent(ACTIVATED_AT))

    expect(testMessageSent).toHaveLength(1)
    expect(testMessageSent[0]?.talkRoomId).toBe(TALK_ROOM_ID)
    expect(testMessageSent[0]?.activatedAt).toEqual(ACTIVATED_AT)
    expect(testMessageSent[0]?.deliveryMessageId).toBeTruthy()
  })

  it('already_delivered（冪等スキップ）でも TestMessageSent を発行する（#590）', async () => {
    const { eventBus, testMessageSent } = setup(stubLineGateway([success]))

    await eventBus.publish(activatedEvent(ACTIVATED_AT))
    await eventBus.publish(activatedEvent(ACTIVATED_AT))

    expect(testMessageSent).toHaveLength(2)
    // 冪等性キーが同一のため、実送信と同じ deliveryMessageId が再発行される
    expect(testMessageSent[1]?.deliveryMessageId).toBe(testMessageSent[0]?.deliveryMessageId)
    expect(testMessageSent[1]?.activatedAt).toEqual(ACTIVATED_AT)
  })

  it('failed（送信失敗）では TestMessageSent を発行しない', async () => {
    const { eventBus, testMessageSent } = setup(stubLineGateway([failure]))

    await eventBus.publish(activatedEvent(ACTIVATED_AT))

    expect(testMessageSent).toHaveLength(0)
  })
})
