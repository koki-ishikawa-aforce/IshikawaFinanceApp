/**
 * 通知配信アプリケーションサービス（#36）
 *
 * 08g §2 の配信ライフサイクルをドメイン関数で編成する:
 *  予約 → 送信中 → LINE push（LineMessagingGateway）→ 成功 / 失敗
 *  → LINE 配信ログ保存（payload 凍結、OQ-34）
 *  → 失敗時は連続失敗カウンタ +1（単発失敗は完全スキップでログのみ、論点23）
 *  → しきい値到達でフェイルセーフメールを 1 回だけ発火（OQ-14）
 *
 * 冪等性: 同一冪等性キーの配信ログが既にあれば送信せずスキップする
 * （同月レポート再送信の重複防止。at-least-once なイベント再配信にも耐える）。
 *
 * OAuth 失効通知はメールフェイルセーフの対象外（OQ-2: 個人 DM のみ）のため、
 * 送信失敗しても連続失敗カウンタを更新しない（ログのみ）。
 */
import type {
  ConsecutiveFailureCounterRepository,
  DeliveryContent,
  DeliveryMessageRepository,
  DeliveryPurpose,
  DeliveryTarget,
  EventBus,
  FailedDeliveryMessage,
  FailsafeEmailGateway,
  FailsafeEmailRepository,
  FailureCounterRef,
  LineDeliveryLog,
  LineDeliveryLogRepository,
  LineMessagingGateway,
  SentDeliveryMessage,
} from '@warimaru/domain'
import {
  counterRefOf,
  createLineDeliveryLog,
  DeliveryLogIdSchema,
  DeliveryLogSavedSchema,
  DeliveryMessageIdSchema,
  FailsafeEmailIdSchema,
  FailsafeEmailSendFailedSchema,
  FailsafeEmailSentSchema,
  FailureThresholdReachedSchema,
  initialFailureCounter,
  isFailsafeCovered,
  markFailsafeFired,
  markFailsafeEmailFailed,
  markFailsafeEmailSent,
  markMessageSendFailed,
  markMessageSent,
  recordSendFailure,
  reserveDeliveryMessage,
  reserveFailsafeEmail,
  resetFailureCounter,
  shouldFireFailsafe,
  SingleSendFailureLoggedSchema,
  startSendingFailsafeEmail,
  startSendingMessage,
  DEFAULT_FAILSAFE_FAILURE_THRESHOLD,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { domainEventBase } from '../event-handlers/event-base.js'

export interface DeliverInput {
  target: DeliveryTarget
  content: DeliveryContent
  purpose: DeliveryPurpose
  /** 同一配信の重複防止キー（呼出し側が用途ごとの規約で計算する） */
  idempotencyKey: string
}

export type DeliverOutcome =
  | { kind: 'sent'; message: SentDeliveryMessage; log: LineDeliveryLog }
  | { kind: 'failed'; message: FailedDeliveryMessage; log: LineDeliveryLog }
  | { kind: 'already_delivered'; log: LineDeliveryLog }

export interface NotificationDeliveryService {
  deliver(input: DeliverInput): Promise<DeliverOutcome>
}

export interface NotificationDeliveryServiceDeps {
  deliveryMessageRepository: DeliveryMessageRepository
  lineDeliveryLogRepository: LineDeliveryLogRepository
  consecutiveFailureCounterRepository: ConsecutiveFailureCounterRepository
  failsafeEmailRepository: FailsafeEmailRepository
  lineMessagingGateway: LineMessagingGateway
  failsafeEmailGateway: FailsafeEmailGateway
  eventBus: EventBus
  /** フェイルセーフメールの宛先（夫婦各自の登録メールアドレス。未設定なら発火を保留する） */
  failsafeEmailRecipients: string[]
  failsafeFailureThreshold?: number | undefined
  now?: (() => Date) | undefined
}

function describeCounterRef(ref: FailureCounterRef): string {
  return ref.kind === 'talk_room' ? `共通トークルーム ${ref.talkRoomId}` : `ユーザー ${ref.userId}`
}

export function createNotificationDeliveryService(
  deps: NotificationDeliveryServiceDeps,
): NotificationDeliveryService {
  const now = deps.now ?? ((): Date => new Date())
  const threshold = deps.failsafeFailureThreshold ?? DEFAULT_FAILSAFE_FAILURE_THRESHOLD

  async function saveLogAndPublish(
    message: SentDeliveryMessage | FailedDeliveryMessage,
    sentPayloadJson: string,
    idempotencyKey: string,
  ): Promise<LineDeliveryLog> {
    const log = createLineDeliveryLog({
      deliveryLogId: DeliveryLogIdSchema.parse(newUlid()),
      message,
      sentPayloadJson,
      idempotencyKey,
    })
    await deps.lineDeliveryLogRepository.save(log)
    await deps.eventBus.publish(
      DeliveryLogSavedSchema.parse({
        ...domainEventBase(now()),
        type: 'DeliveryLogSaved',
        deliveryLogId: log.deliveryLogId,
        deliveryMessageId: log.deliveryMessageId,
        status: log.resultStatus.kind,
      }),
    )
    return log
  }

  /** しきい値到達済み・未発火ならフェイルセーフメールを生成・送信し、発火済みを記録する */
  async function fireFailsafeEmail(ref: FailureCounterRef, at: Date): Promise<void> {
    const counter = await deps.consecutiveFailureCounterRepository.findByRef(ref)
    if (counter === null || !shouldFireFailsafe(counter)) return
    if (deps.failsafeEmailRecipients.length === 0) {
      console.warn(
        '[notification] フェイルセーフメール宛先が未設定のため発火を保留する（FAILSAFE_EMAIL_TO を設定する）',
      )
      return
    }

    const [primary, ...rest] = deps.failsafeEmailRecipients
    if (primary === undefined) return
    const failsafeEmailId = FailsafeEmailIdSchema.parse(newUlid())

    const subject = '【割まる】LINE通知の連続送信失敗を検知しました'
    const body = [
      `${describeCounterRef(ref)} 宛の LINE 通知が ${counter.consecutiveFailureCount} 回連続で失敗しました。`,
      'LINE 側の障害または設定不備の可能性があります。アプリの通知設定と LINE 公式アカウントの状態を確認してください。',
      `最終失敗日時: ${counter.lastFailedAt?.toISOString() ?? '不明'}`,
    ].join('\n')

    let anySucceeded = false
    for (const [index, toEmailAddress] of [primary, ...rest].entries()) {
      const emailId = index === 0 ? failsafeEmailId : FailsafeEmailIdSchema.parse(newUlid())
      const reserved = reserveFailsafeEmail(
        { failsafeEmailId: emailId, toEmailAddress, subject, body, causingCounterRef: ref },
        at,
      )
      const sending = startSendingFailsafeEmail(reserved, now())
      const result = await deps.failsafeEmailGateway.send(sending)
      if (result.kind === 'success') {
        anySucceeded = true
        const sent = markFailsafeEmailSent(sending, result.providerRef, now())
        await deps.failsafeEmailRepository.save(sent)
        await deps.eventBus.publish(
          FailsafeEmailSentSchema.parse({
            ...domainEventBase(now()),
            type: 'FailsafeEmailSent',
            failsafeEmailId: emailId,
            toEmailAddress,
          }),
        )
      } else {
        const failed = markFailsafeEmailFailed(sending, result.failureReason, now())
        await deps.failsafeEmailRepository.save(failed)
        console.error(`[notification] フェイルセーフメール送信失敗: ${result.detail}`)
        await deps.eventBus.publish(
          FailsafeEmailSendFailedSchema.parse({
            ...domainEventBase(now()),
            type: 'FailsafeEmailSendFailed',
            failsafeEmailId: emailId,
            failureReason: result.failureReason,
          }),
        )
      }
    }

    // 発火済みは送信成功後に記録する（OQ-14）: 全宛先失敗なら次回 LINE 連続失敗時に再送される
    if (anySucceeded) {
      await deps.consecutiveFailureCounterRepository.save(
        markFailsafeFired(counter, failsafeEmailId, at),
      )
    }
  }

  return {
    async deliver(input): Promise<DeliverOutcome> {
      const existing = await deps.lineDeliveryLogRepository.findByIdempotencyKey(
        input.idempotencyKey,
      )
      if (existing !== null) {
        return { kind: 'already_delivered', log: existing }
      }

      const reserved = reserveDeliveryMessage(
        {
          deliveryMessageId: DeliveryMessageIdSchema.parse(newUlid()),
          target: input.target,
          content: input.content,
          purpose: input.purpose,
        },
        now(),
      )
      await deps.deliveryMessageRepository.save(reserved)

      const sending = startSendingMessage(reserved, now())
      const outcome = await deps.lineMessagingGateway.sendPush(input.target, input.content)

      if (outcome.result.kind === 'success') {
        const sent = markMessageSent(sending, outcome.result.lineMessageId, now())
        await deps.deliveryMessageRepository.save(sent)
        const log = await saveLogAndPublish(sent, outcome.sentPayloadJson, input.idempotencyKey)
        // 送信成功で連続失敗を断ち切る（連続失敗のみカウント、論点23）
        const ref = counterRefOf(input.target)
        const counter = await deps.consecutiveFailureCounterRepository.findByRef(ref)
        if (counter !== null && counter.consecutiveFailureCount > 0) {
          await deps.consecutiveFailureCounterRepository.save(resetFailureCounter(counter))
        }
        return { kind: 'sent', message: sent, log }
      }

      const failedAt = now()
      // 単発失敗は完全スキップ（リトライ基盤なし、論点23）→ リトライ放棄で終端化
      const failed = markMessageSendFailed(
        sending,
        outcome.result.failureReason,
        'retry_abandoned',
        failedAt,
      )
      await deps.deliveryMessageRepository.save(failed)
      console.error(
        `[notification] LINE 送信失敗（${failed.failureReason}）: ${outcome.result.detail}`,
      )
      const log = await saveLogAndPublish(failed, outcome.sentPayloadJson, input.idempotencyKey)
      await deps.eventBus.publish(
        SingleSendFailureLoggedSchema.parse({
          ...domainEventBase(failedAt),
          type: 'SingleSendFailureLogged',
          deliveryMessageId: failed.common.deliveryMessageId,
          failureReason: failed.failureReason,
        }),
      )

      if (isFailsafeCovered(input.purpose)) {
        const ref = counterRefOf(input.target)
        const counter =
          (await deps.consecutiveFailureCounterRepository.findByRef(ref)) ??
          initialFailureCounter(ref)
        const updated = recordSendFailure(counter, failedAt, threshold)
        await deps.consecutiveFailureCounterRepository.save(updated)
        if (
          counter.thresholdState.kind !== 'reached' &&
          updated.thresholdState.kind === 'reached'
        ) {
          await deps.eventBus.publish(
            FailureThresholdReachedSchema.parse({
              ...domainEventBase(failedAt),
              type: 'FailureThresholdReached',
              counterRef: ref,
              consecutiveFailureCount: updated.consecutiveFailureCount,
            }),
          )
        }
        await fireFailsafeEmail(ref, failedAt)
      }

      return { kind: 'failed', message: failed, log }
    },
  }
}
