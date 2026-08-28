/**
 * アクセス拒否記録ハンドラー（見知らぬ相手からのアクセス拒否を記録する、Issue #651）
 *
 * `AccessDenied`（許可リスト不一致による拒否）を購読し、LINE_userID ごとに
 * 拒否回数・最終発生日時を集約する（08f §1 §2。同じ相手からの拒否は1件へ集約する、決定 A-1）。
 *
 * 冪等性: dedup キーは持たない。イベント配信は at-least-once（#34）のため、同一の拒否要求が
 * クライアント再送等で二重に届くと拒否累計回数が過大になりうる。このカウンタは「いつ・何回・
 * どこを叩かれたか」に気づくための目安であり（#651）、しきい値超過で自動発火する副作用を
 * 持たない（`ConsecutiveFailureCounter` と異なり、配信確定の冪等性キーで保護される必要が無い）
 * ため、多少の過大カウントは許容する。
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
