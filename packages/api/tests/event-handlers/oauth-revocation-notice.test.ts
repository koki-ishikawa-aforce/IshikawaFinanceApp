/**
 * OAuth 失効通知ハンドラー（#392）の単体テスト。
 * GmailOauthRevocationDetected → 個人 DM 配信 → OauthRevocationNoticeDelivered の
 * 発行条件と、at-least-once 再配信での冪等性・失敗後の再送を直接固定する。
 */
import { describe, it, expect } from 'vitest'
import type {
  DeliveryContent,
  DeliveryTarget,
  LineMessagingGateway,
  LinePushResult,
  OauthRevocationNoticeDelivered,
} from '@warimaru/domain'
import {
  GmailOauthRevocationDetectedSchema,
  InMemoryEventBus,
  LineMessageIdSchema,
  UserIdSchema,
} from '@warimaru/domain'
import { registerOauthRevocationNoticeEventHandlers } from '../../src/event-handlers/oauth-revocation-notice.js'
import { domainEventBase } from '../../src/event-handlers/event-base.js'
import { createNotificationDeliveryService } from '../../src/notification/delivery-service.js'
import { createDeepLinkBuilder } from '../../src/notification/deep-links.js'
import {
  createMockConsecutiveFailureCounterRepository,
  createMockDeliveryMessageRepository,
  createMockFailsafeEmailRepository,
  createMockLineDeliveryLogRepository,
} from '../../src/mock-repositories.js'

const USER_ID = UserIdSchema.parse('user-honey-test')
const DETECTED_AT = new Date('2026-08-01T21:00:00Z')
const BASE_URL = 'https://liff.line.me/1234567890-abcdefgh'

const success: LinePushResult = {
  kind: 'success',
  lineMessageId: LineMessageIdSchema.parse('line-msg-1'),
}

/** 応答列を順に返し、呼び出しを記録するスタブ LINE ゲートウェイ */
function stubLineGateway(results: LinePushResult[]): LineMessagingGateway & {
  calls: { target: DeliveryTarget; content: DeliveryContent }[]
} {
  const calls: { target: DeliveryTarget; content: DeliveryContent }[] = []
  return {
    calls,
    sendPush(target: DeliveryTarget, content: DeliveryContent) {
      const result = results[Math.min(calls.length, results.length - 1)]
      calls.push({ target, content })
      if (result === undefined) throw new Error('スタブ応答が未定義')
      return Promise.resolve({ sentPayloadJson: JSON.stringify(content), result })
    },
  }
}

function revocationDetectedEvent(detectedAt: Date) {
  return GmailOauthRevocationDetectedSchema.parse({
    ...domainEventBase(detectedAt),
    type: 'GmailOauthRevocationDetected',
    userId: USER_ID,
    detectedAt,
  })
}

function setup(lineGateway: LineMessagingGateway) {
  const eventBus = new InMemoryEventBus()
  const delivered: OauthRevocationNoticeDelivered[] = []
  eventBus.subscribe<OauthRevocationNoticeDelivered>('OauthRevocationNoticeDelivered', e => {
    delivered.push(e)
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
  registerOauthRevocationNoticeEventHandlers(eventBus, {
    notificationDeliveryService,
    deepLinks: createDeepLinkBuilder(BASE_URL),
  })

  return { eventBus, delivered }
}

describe('registerOauthRevocationNoticeEventHandlers', () => {
  it('失効検知で本人の個人 DM に配信し、OauthRevocationNoticeDelivered を発行する', async () => {
    const gateway = stubLineGateway([success])
    const { eventBus, delivered } = setup(gateway)

    await eventBus.publish(revocationDetectedEvent(DETECTED_AT))

    expect(gateway.calls).toHaveLength(1)
    expect(gateway.calls[0]?.target).toEqual({ kind: 'personal_dm', userId: USER_ID })
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.userId).toBe(USER_ID)
    expect(delivered[0]?.deliveryMessageId).toBeTruthy()
  })

  it('本文の導線が設定画面の Gmail 連携タブ（論点57 ④）を指す', async () => {
    const gateway = stubLineGateway([success])
    const { eventBus } = setup(gateway)

    await eventBus.publish(revocationDetectedEvent(DETECTED_AT))

    const content = gateway.calls[0]?.content
    expect(content?.kind).toBe('flex_message')
    expect(content?.linkUrl).toBe(`${BASE_URL}/settings?section=oauth&provider=gmail`)
    // Flex payload のボタンも同じ URL を持つ（本文とリンクの食い違いを作らない）
    expect(content?.kind === 'flex_message' ? content.flexPayloadJson : '').toContain(
      `${BASE_URL}/settings?section=oauth&provider=gmail`,
    )
  })

  it('同一の検知日時の再配信（at-least-once）では 2 通目を送らない', async () => {
    const gateway = stubLineGateway([success])
    const { eventBus, delivered } = setup(gateway)

    await eventBus.publish(revocationDetectedEvent(DETECTED_AT))
    await eventBus.publish(revocationDetectedEvent(DETECTED_AT))

    expect(gateway.calls).toHaveLength(1)
    expect(delivered).toHaveLength(1)
  })

  it('未達が確定した失敗（LINE API エラー）の後の再配信では送り直す', async () => {
    const gateway = stubLineGateway([
      { kind: 'failure', failureReason: 'line_api_failure', detail: 'stub 500' },
      success,
    ])
    const { eventBus, delivered } = setup(gateway)

    await eventBus.publish(revocationDetectedEvent(DETECTED_AT))
    expect(delivered).toHaveLength(0)

    // 日次バッチが失効状態を見て同じ検知日時で再発行する（daily-mail-import.ts）
    await eventBus.publish(revocationDetectedEvent(DETECTED_AT))

    expect(gateway.calls).toHaveLength(2)
    expect(delivered).toHaveLength(1)
  })

  it('確定する失敗（宛先不正）の後の再配信では送り直さない', async () => {
    const gateway = stubLineGateway([
      { kind: 'failure', failureReason: 'invalid_target', detail: 'stub invalid' },
      success,
    ])
    const { eventBus, delivered } = setup(gateway)

    await eventBus.publish(revocationDetectedEvent(DETECTED_AT))
    await eventBus.publish(revocationDetectedEvent(DETECTED_AT))

    expect(gateway.calls).toHaveLength(1)
    expect(delivered).toHaveLength(0)
  })

  it('再認可後に改めて失効した（検知日時が異なる）ときは新しい通知として届く', async () => {
    const gateway = stubLineGateway([success])
    const { eventBus, delivered } = setup(gateway)

    await eventBus.publish(revocationDetectedEvent(DETECTED_AT))
    await eventBus.publish(revocationDetectedEvent(new Date('2026-08-15T21:00:00Z')))

    expect(gateway.calls).toHaveLength(2)
    expect(delivered).toHaveLength(2)
  })
})
