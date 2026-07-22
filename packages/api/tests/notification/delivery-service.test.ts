import { describe, it, expect, beforeEach } from 'vitest'
import type {
  DeliveryContent,
  DeliveryTarget,
  DomainEvent,
  FailsafeEmailGateway,
  LineMessagingGateway,
  LinePushResult,
} from '@warimaru/domain'
import {
  DeliveryContentSchema,
  DeliveryTargetSchema,
  FailureCounterRefSchema,
  InMemoryEventBus,
  LineMessageIdSchema,
} from '@warimaru/domain'
import {
  createNotificationDeliveryService,
  type NotificationDeliveryService,
  type NotificationDeliveryServiceDeps,
} from '../../src/notification/delivery-service.js'
import {
  createMockConsecutiveFailureCounterRepository,
  createMockDeliveryMessageRepository,
  createMockFailsafeEmailRepository,
  createMockLineDeliveryLogRepository,
} from '../../src/mock-repositories.js'

const talkRoomTarget: DeliveryTarget = DeliveryTargetSchema.parse({
  kind: 'shared_talk_room',
  talkRoomId: 'room_001',
})
const dmTarget: DeliveryTarget = DeliveryTargetSchema.parse({
  kind: 'personal_dm',
  userId: 'user_honey',
})
const textContent: DeliveryContent = DeliveryContentSchema.parse({
  kind: 'plain_text',
  textBody: 'テスト本文',
})

/** 応答列を順に返すスタブ LINE ゲートウェイ（列を使い切ったら最後の応答を繰り返す） */
function stubLineGateway(results: LinePushResult[]): LineMessagingGateway & { calls: number } {
  const gateway = {
    calls: 0,
    sendPush(_target: DeliveryTarget, _content: DeliveryContent) {
      const result = results[Math.min(gateway.calls, results.length - 1)]
      gateway.calls += 1
      if (result === undefined) throw new Error('スタブ応答が未定義')
      return Promise.resolve({ sentPayloadJson: '{"stub":true}', result })
    },
  }
  return gateway
}

function stubEmailGateway(): FailsafeEmailGateway & { sentTo: string[] } {
  const gateway = {
    sentTo: [] as string[],
    send(email: Parameters<FailsafeEmailGateway['send']>[0]) {
      gateway.sentTo.push(email.common.toEmailAddress)
      return Promise.resolve({ kind: 'success' as const, providerRef: 'stub-provider-ref' })
    },
  }
  return gateway
}

const success: LinePushResult = {
  kind: 'success',
  lineMessageId: LineMessageIdSchema.parse('line-msg-1'),
}
const failure: LinePushResult = {
  kind: 'failure',
  failureReason: 'line_api_failure',
  detail: 'stub failure',
}

describe('NotificationDeliveryService', () => {
  let deps: NotificationDeliveryServiceDeps
  let events: DomainEvent[]

  function build(
    lineGateway: LineMessagingGateway,
    overrides: Partial<NotificationDeliveryServiceDeps> = {},
  ): NotificationDeliveryService {
    const eventBus = new InMemoryEventBus()
    for (const type of [
      'DeliveryLogSaved',
      'SingleSendFailureLogged',
      'FailureThresholdReached',
      'FailsafeEmailSent',
      'FailsafeEmailSendFailed',
    ]) {
      eventBus.subscribe(type, event => {
        events.push(event)
      })
    }
    deps = {
      deliveryMessageRepository: createMockDeliveryMessageRepository(),
      lineDeliveryLogRepository: createMockLineDeliveryLogRepository(),
      consecutiveFailureCounterRepository: createMockConsecutiveFailureCounterRepository(),
      failsafeEmailRepository: createMockFailsafeEmailRepository(),
      lineMessagingGateway: lineGateway,
      failsafeEmailGateway: stubEmailGateway(),
      eventBus,
      failsafeEmailRecipients: ['honey@example.com', 'darling@example.com'],
      ...overrides,
    }
    return createNotificationDeliveryService(deps)
  }

  beforeEach(() => {
    events = []
  })

  it('送信成功: メッセージ終端化・配信ログ保存（payload 凍結）・DeliveryLogSaved 発火', async () => {
    const gateway = stubLineGateway([success])
    const service = build(gateway)
    const outcome = await service.deliver({
      target: talkRoomTarget,
      content: textContent,
      purpose: 'test_message',
      idempotencyKey: 'key-1',
    })
    expect(outcome.kind).toBe('sent')
    if (outcome.kind !== 'sent') return
    expect(outcome.message.lineMessageId).toBe('line-msg-1')
    const saved = await deps.deliveryMessageRepository.findById(
      outcome.message.common.deliveryMessageId,
    )
    expect(saved?.kind).toBe('sent')
    const log = await deps.lineDeliveryLogRepository.findByIdempotencyKey('key-1')
    expect(log?.resultStatus.kind).toBe('success')
    expect(log?.sentPayloadJson).toBe('{"stub":true}')
    expect(log?.timingKind).toBe('test_send')
    expect(events.map(e => e.type)).toEqual(['DeliveryLogSaved'])
  })

  it('冪等性: 同一キーの 2 回目は送信せず already_delivered を返す', async () => {
    const gateway = stubLineGateway([success])
    const service = build(gateway)
    const input = {
      target: talkRoomTarget,
      content: textContent,
      purpose: 'test_message' as const,
      idempotencyKey: 'key-dup',
    }
    await service.deliver(input)
    const second = await service.deliver(input)
    expect(second.kind).toBe('already_delivered')
    expect(gateway.calls).toBe(1)
  })

  it('送信失敗: リトライ放棄で終端化し、失敗ログ + SingleSendFailureLogged + カウンタ +1', async () => {
    const gateway = stubLineGateway([failure])
    const service = build(gateway)
    const outcome = await service.deliver({
      target: talkRoomTarget,
      content: textContent,
      purpose: 'csv_import_reminder',
      idempotencyKey: 'key-f1',
    })
    expect(outcome.kind).toBe('failed')
    if (outcome.kind !== 'failed') return
    expect(outcome.message.retryState).toBe('retry_abandoned')
    expect(outcome.log.resultStatus.kind).toBe('failure')
    expect(events.map(e => e.type)).toEqual(['DeliveryLogSaved', 'SingleSendFailureLogged'])
    const counter = await deps.consecutiveFailureCounterRepository.findByRef(
      FailureCounterRefSchema.parse({ kind: 'talk_room', talkRoomId: 'room_001' }),
    )
    expect(counter?.consecutiveFailureCount).toBe(1)
    expect(counter?.thresholdState.kind).toBe('not_reached')
  })

  it('しきい値到達: FailureThresholdReached とフェイルセーフメールを全宛先へ 1 回だけ発火する（OQ-14）', async () => {
    const gateway = stubLineGateway([failure])
    const service = build(gateway, { failsafeFailureThreshold: 3 })
    const emailGateway = deps.failsafeEmailGateway as FailsafeEmailGateway & { sentTo: string[] }
    for (let i = 0; i < 3; i++) {
      await service.deliver({
        target: talkRoomTarget,
        content: textContent,
        purpose: 'csv_import_reminder',
        idempotencyKey: `key-t${i}`,
      })
    }
    expect(events.filter(e => e.type === 'FailureThresholdReached')).toHaveLength(1)
    expect(emailGateway.sentTo).toEqual(['honey@example.com', 'darling@example.com'])
    expect(events.filter(e => e.type === 'FailsafeEmailSent')).toHaveLength(2)

    // 4 回目の失敗では再発火しない
    await service.deliver({
      target: talkRoomTarget,
      content: textContent,
      purpose: 'csv_import_reminder',
      idempotencyKey: 'key-t4',
    })
    expect(emailGateway.sentTo).toHaveLength(2)
    expect(events.filter(e => e.type === 'FailureThresholdReached')).toHaveLength(1)
  })

  it('送信成功で連続失敗カウンタがリセットされる（連続失敗のみカウント、論点23）', async () => {
    const gateway = stubLineGateway([failure, failure, success])
    const service = build(gateway, { failsafeFailureThreshold: 3 })
    for (let i = 0; i < 3; i++) {
      await service.deliver({
        target: talkRoomTarget,
        content: textContent,
        purpose: 'csv_import_reminder',
        idempotencyKey: `key-r${i}`,
      })
    }
    const counter = await deps.consecutiveFailureCounterRepository.findByRef(
      FailureCounterRefSchema.parse({ kind: 'talk_room', talkRoomId: 'room_001' }),
    )
    expect(counter?.consecutiveFailureCount).toBe(0)
    expect(events.filter(e => e.type === 'FailureThresholdReached')).toHaveLength(0)
  })

  it('OAuth 失効通知の失敗はカウンタを更新しない（メールフェイルセーフ対象外、OQ-2）', async () => {
    const gateway = stubLineGateway([failure])
    const service = build(gateway, { failsafeFailureThreshold: 1 })
    const outcome = await service.deliver({
      target: dmTarget,
      content: textContent,
      purpose: 'oauth_revocation_notice',
      idempotencyKey: 'key-oauth',
    })
    expect(outcome.kind).toBe('failed')
    const counter = await deps.consecutiveFailureCounterRepository.findByRef(
      FailureCounterRefSchema.parse({ kind: 'user', userId: 'user_honey' }),
    )
    expect(counter).toBeNull()
    expect(events.filter(e => e.type === 'FailureThresholdReached')).toHaveLength(0)
    expect(events.filter(e => e.type === 'FailsafeEmailSent')).toHaveLength(0)
  })

  it('宛先未設定ならフェイルセーフ発火を保留し、後続の失敗で再試行できる', async () => {
    const gateway = stubLineGateway([failure])
    const service = build(gateway, { failsafeFailureThreshold: 1, failsafeEmailRecipients: [] })
    await service.deliver({
      target: talkRoomTarget,
      content: textContent,
      purpose: 'csv_import_reminder',
      idempotencyKey: 'key-n1',
    })
    const counter = await deps.consecutiveFailureCounterRepository.findByRef(
      FailureCounterRefSchema.parse({ kind: 'talk_room', talkRoomId: 'room_001' }),
    )
    expect(counter?.thresholdState.kind).toBe('reached')
    expect(events.filter(e => e.type === 'FailsafeEmailSent')).toHaveLength(0)
  })
})
