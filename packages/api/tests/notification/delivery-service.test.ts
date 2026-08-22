import { describe, it, expect, beforeEach } from 'vitest'
import type {
  DeliveryContent,
  DeliveryTarget,
  DomainEvent,
  FailsafeEmailGateway,
  FailsafeEmailSendResult,
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

/** 応答列を順に返すスタブメールゲートウェイ（列を使い切ったら最後の応答を繰り返す） */
function stubEmailGatewayWithResults(
  results: FailsafeEmailSendResult[],
): FailsafeEmailGateway & { calls: number; sentTo: string[] } {
  const gateway = {
    calls: 0,
    sentTo: [] as string[],
    send(email: Parameters<FailsafeEmailGateway['send']>[0]) {
      const result = results[Math.min(gateway.calls, results.length - 1)]
      gateway.calls += 1
      gateway.sentTo.push(email.common.toEmailAddress)
      if (result === undefined) throw new Error('スタブ応答が未定義')
      return Promise.resolve(result)
    },
  }
  return gateway
}

const emailSuccess: FailsafeEmailSendResult = { kind: 'success', providerRef: 'stub-provider-ref' }
const emailFailure: FailsafeEmailSendResult = {
  kind: 'failure',
  failureReason: 'smtp_failure',
  detail: 'stub email failure',
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

  /** 冪等性キーに紐づく配信ログを保存順に取り出す（失敗ログが積まれるため 0..N 件） */
  async function logsOf(idempotencyKey: string) {
    return deps.lineDeliveryLogRepository.findAllByIdempotencyKey(idempotencyKey)
  }

  /** 冪等性キーの最後の配信ログ */
  async function lastLogOf(idempotencyKey: string) {
    return (await logsOf(idempotencyKey)).at(-1) ?? null
  }

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

  describe('skip（送信せずスキップとして記録する）', () => {
    it('LINE を呼ばずにスキップを終端記録し、配信ログへ理由を凍結する', async () => {
      const gateway = stubLineGateway([success])
      const service = build(gateway)
      const outcome = await service.skip({
        target: talkRoomTarget,
        content: textContent,
        purpose: 'csv_import_reminder',
        idempotencyKey: 'skip-key-1',
        skipReason: 'reminder_stop_condition_met',
      })

      expect(outcome.kind).toBe('skipped')
      expect(gateway.calls).toBe(0)
      if (outcome.kind !== 'skipped') return
      const saved = await deps.deliveryMessageRepository.findById(
        outcome.message.common.deliveryMessageId,
      )
      expect(saved?.kind).toBe('skipped')
      const log = await lastLogOf('skip-key-1')
      expect(log?.resultStatus).toMatchObject({
        kind: 'skipped',
        skipReason: 'reminder_stop_condition_met',
      })
      expect(log?.timingKind).toBe('reminder')
      expect(log?.sentPayloadJson).toContain('reminder_stop_condition_met')
      expect(events.filter(e => e.type === 'DeliveryLogSaved')).toHaveLength(1)
    })

    it('同一冪等性キーの 2 回目は already_delivered（呼出し側が停止イベントを二重発火しないため）', async () => {
      const service = build(stubLineGateway([success]))
      const input = {
        target: talkRoomTarget,
        content: textContent,
        purpose: 'csv_import_reminder' as const,
        idempotencyKey: 'skip-key-2',
        skipReason: 'reminder_stop_condition_met' as const,
      }
      await service.skip(input)
      const second = await service.skip(input)

      expect(second.kind).toBe('already_delivered')
      expect(events.filter(e => e.type === 'DeliveryLogSaved')).toHaveLength(1)
    })

    it('スキップは連続失敗カウンタを進めない（送信失敗ではないため）', async () => {
      const service = build(stubLineGateway([success]))
      await service.skip({
        target: talkRoomTarget,
        content: textContent,
        purpose: 'csv_import_reminder',
        idempotencyKey: 'skip-key-3',
        skipReason: 'reminder_stop_condition_met',
      })

      const counter = await deps.consecutiveFailureCounterRepository.findByRef(
        FailureCounterRefSchema.parse({ kind: 'talk_room', talkRoomId: 'room_001' }),
      )
      expect(counter).toBeNull()
      expect(events.filter(e => e.type === 'SingleSendFailureLogged')).toHaveLength(0)
    })
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
    const log = await lastLogOf('key-1')
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

  describe('失敗した配信の再送信（#441-A）', () => {
    it('前回が失敗なら同一キーでも送信し直す（月次サマリが 1 回の失敗で永久に届かなくならない）', async () => {
      // 1 回目失敗 → 2 回目成功。月次レポートサマリは月に 1 通しか送る機会が無い
      const gateway = stubLineGateway([failure, success])
      const service = build(gateway)
      const input = {
        target: talkRoomTarget,
        content: textContent,
        purpose: 'monthly_report_household_summary' as const,
        idempotencyKey: 'key-retry-1',
      }

      const first = await service.deliver(input)
      expect(first.kind).toBe('failed')
      const second = await service.deliver(input)

      expect(second.kind).toBe('sent')
      expect(gateway.calls).toBe(2)
      // 失敗の記録は監査記録として残り、成功が後ろに積まれる
      expect((await logsOf('key-retry-1')).map(l => l.resultStatus.kind)).toEqual([
        'failure',
        'success',
      ])
    })

    it('再送信が成功したあとは already_delivered に戻る（3 回目は送らない）', async () => {
      const gateway = stubLineGateway([failure, success])
      const service = build(gateway)
      const input = {
        target: talkRoomTarget,
        content: textContent,
        purpose: 'monthly_report_household_summary' as const,
        idempotencyKey: 'key-retry-2',
      }

      await service.deliver(input)
      await service.deliver(input)
      const third = await service.deliver(input)

      expect(third.kind).toBe('already_delivered')
      expect(gateway.calls).toBe(2)
      expect(await logsOf('key-retry-2')).toHaveLength(2)
    })

    it('失敗が続く間は何度でも送信し直す（回復の機会を失わない）', async () => {
      const gateway = stubLineGateway([failure])
      const service = build(gateway)
      const input = {
        target: talkRoomTarget,
        content: textContent,
        purpose: 'monthly_report_household_summary' as const,
        idempotencyKey: 'key-retry-3',
      }

      await service.deliver(input)
      await service.deliver(input)
      const third = await service.deliver(input)

      expect(third.kind).toBe('failed')
      expect(gateway.calls).toBe(3)
      expect(await logsOf('key-retry-3')).toHaveLength(3)
    })

    it('スキップで確定したキーは再送信しない（送らないと決めた事実は確定している）', async () => {
      const gateway = stubLineGateway([success])
      const service = build(gateway)
      const common = {
        target: talkRoomTarget,
        content: textContent,
        purpose: 'csv_import_reminder' as const,
        idempotencyKey: 'key-retry-4',
      }

      await service.skip({ ...common, skipReason: 'reminder_stop_condition_met' })
      const outcome = await service.deliver(common)

      expect(outcome.kind).toBe('already_delivered')
      expect(gateway.calls).toBe(0)
    })

    it('失敗したキーへの skip は記録され、確定として扱われる', async () => {
      const gateway = stubLineGateway([failure])
      const service = build(gateway)
      const common = {
        target: talkRoomTarget,
        content: textContent,
        purpose: 'csv_import_reminder' as const,
        idempotencyKey: 'key-retry-5',
      }

      await service.deliver(common)
      const skipped = await service.skip({ ...common, skipReason: 'notification_disabled' })
      const afterSkip = await service.deliver(common)

      expect(skipped.kind).toBe('skipped')
      expect(afterSkip.kind).toBe('already_delivered')
      expect(gateway.calls).toBe(1)
    })
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

  it('送信基盤の失敗時は発火済みにせず、次回の連続失敗で再送を試みる（OQ-50）', async () => {
    const ref = FailureCounterRefSchema.parse({ kind: 'talk_room', talkRoomId: 'room_001' })
    // 宛先 2 件。1 回目の発火（2 通）は基盤失敗、以降は成功する応答列。
    const emailGateway = stubEmailGatewayWithResults([emailFailure, emailFailure, emailSuccess])
    const service = build(stubLineGateway([failure]), {
      failsafeFailureThreshold: 1,
      failsafeEmailRecipients: ['honey@example.com', 'darling@example.com'],
      failsafeEmailGateway: emailGateway,
    })

    // 1 回目の連続失敗でしきい値到達 → メール送信を試みるが基盤失敗 → 発火済みにしない
    await service.deliver({
      target: talkRoomTarget,
      content: textContent,
      purpose: 'csv_import_reminder',
      idempotencyKey: 'key-e1',
    })
    expect(emailGateway.calls).toBe(2)
    expect(events.filter(e => e.type === 'FailsafeEmailSendFailed')).toHaveLength(2)
    expect(events.filter(e => e.type === 'FailsafeEmailSent')).toHaveLength(0)
    let counter = await deps.consecutiveFailureCounterRepository.findByRef(ref)
    expect(counter?.thresholdState.kind).toBe('reached')
    if (counter?.thresholdState.kind === 'reached') {
      // 送信基盤の失敗では発火済みにしない（次回に再送できる状態を保つ）
      expect(counter.thresholdState.failsafeState.kind).toBe('not_fired')
    }

    // 2 回目の連続失敗 → 未発火なので再送を試みる → 今度は成功 → 発火済みになる
    await service.deliver({
      target: talkRoomTarget,
      content: textContent,
      purpose: 'csv_import_reminder',
      idempotencyKey: 'key-e2',
    })
    expect(emailGateway.calls).toBe(4) // 宛先 2 件へ再送された
    expect(events.filter(e => e.type === 'FailsafeEmailSent')).toHaveLength(2)
    // 再送成功で新たな送信失敗イベントは増えない
    expect(events.filter(e => e.type === 'FailsafeEmailSendFailed')).toHaveLength(2)
    counter = await deps.consecutiveFailureCounterRepository.findByRef(ref)
    expect(counter?.thresholdState.kind).toBe('reached')
    if (counter?.thresholdState.kind === 'reached') {
      expect(counter.thresholdState.failsafeState.kind).toBe('fired')
    }

    // 3 回目の連続失敗 → 発火済みなので二重送信しない
    await service.deliver({
      target: talkRoomTarget,
      content: textContent,
      purpose: 'csv_import_reminder',
      idempotencyKey: 'key-e3',
    })
    expect(emailGateway.calls).toBe(4)
    expect(events.filter(e => e.type === 'FailsafeEmailSent')).toHaveLength(2)
  })

  it('宛先が空のときは発火済みにせず、宛先設定後の連続失敗で改めて送信する（OQ-50）', async () => {
    const counterRepo = createMockConsecutiveFailureCounterRepository()
    const ref = FailureCounterRefSchema.parse({ kind: 'talk_room', talkRoomId: 'room_001' })

    // 宛先未設定で連続失敗しきい値に到達 → 発火は保留（発火済みにしない）
    const emptyService = build(stubLineGateway([failure]), {
      failsafeFailureThreshold: 1,
      failsafeEmailRecipients: [],
      consecutiveFailureCounterRepository: counterRepo,
    })
    await emptyService.deliver({
      target: talkRoomTarget,
      content: textContent,
      purpose: 'csv_import_reminder',
      idempotencyKey: 'key-empty-1',
    })
    let counter = await counterRepo.findByRef(ref)
    expect(counter?.thresholdState.kind).toBe('reached')
    if (counter?.thresholdState.kind === 'reached') {
      expect(counter.thresholdState.failsafeState.kind).toBe('not_fired')
    }

    // 宛先を設定して次の連続失敗 → 保留していた発火が改めて送信される
    const emailGateway = stubEmailGatewayWithResults([emailSuccess])
    const configuredService = build(stubLineGateway([failure]), {
      failsafeFailureThreshold: 1,
      failsafeEmailRecipients: ['honey@example.com'],
      consecutiveFailureCounterRepository: counterRepo,
      failsafeEmailGateway: emailGateway,
    })
    await configuredService.deliver({
      target: talkRoomTarget,
      content: textContent,
      purpose: 'csv_import_reminder',
      idempotencyKey: 'key-empty-2',
    })
    expect(emailGateway.sentTo).toEqual(['honey@example.com'])
    counter = await counterRepo.findByRef(ref)
    expect(counter?.thresholdState.kind).toBe('reached')
    if (counter?.thresholdState.kind === 'reached') {
      expect(counter.thresholdState.failsafeState.kind).toBe('fired')
    }
  })
})
