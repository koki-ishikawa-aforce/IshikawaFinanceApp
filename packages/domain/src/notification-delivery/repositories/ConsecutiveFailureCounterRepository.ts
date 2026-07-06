/**
 * 連続失敗カウンタ Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.6
 */
import type {
  ConsecutiveFailureCounter,
  FailureCounterRef,
} from '../value-objects/ConsecutiveFailureCounter'

export interface ConsecutiveFailureCounterRepository {
  findByRef(ref: FailureCounterRef): Promise<ConsecutiveFailureCounter | null>
  save(counter: ConsecutiveFailureCounter): Promise<void>
}
