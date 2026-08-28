/**
 * アクセス拒否記録ハンドラー（見知らぬ相手からのアクセス拒否を記録する、Issue #651）
 *
 * `AccessDenied`（許可リスト不一致による拒否）を購読し、LINE_userID ごとに
 * 拒否回数・最終発生日時を集約する（08f §1 §2。同じ相手からの拒否は1件へ集約する、決定 A-1）。
 */
import { recordAccessDenial } from '@warimaru/domain'
import type { AccessDenialCounterRepository, AccessDenied, EventBus } from '@warimaru/domain'
import { safeSubscribe } from './safe-subscribe.js'

export interface AccessDenialRecordHandlerDeps {
  accessDenialCounterRepository: AccessDenialCounterRepository
}

export function registerAccessDenialRecordEventHandlers(
  eventBus: EventBus,
  deps: AccessDenialRecordHandlerDeps,
): void {
  safeSubscribe<AccessDenied>(eventBus, 'AccessDenied', async event => {
    const existing = await deps.accessDenialCounterRepository.findByLineUserId(event.lineUserId)
    const counter = recordAccessDenial(existing, event.lineUserId, event.occurredAt)
    await deps.accessDenialCounterRepository.save(counter)
  })
}
