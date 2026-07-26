/**
 * ドメインエラー型階層
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.4
 *
 * ポリシー:
 *  - Repository.findById は「見つからない」を Promise<T | null> で表現し throw しない
 *  - 集約の状態遷移が不変条件違反 → InvariantViolationError を throw
 *  - Query で明示的な権限拒否 → PermissionDeniedError を throw
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class InvariantViolationError extends DomainError {}

/**
 * 同一取引の二重計上を拒否した（未払金計上の冪等ガード）。
 * 呼び出し側は「計上済みのためスキップ」として扱ってよい。
 * エラーメッセージの文言に依存せず型で判別できるよう、専用型として切り出している。
 */
export class UnpaidAlreadyBookedError extends InvariantViolationError {}

/**
 * 同一の引落確定通知の重複適用を拒否した（消込・残高反映の冪等ガード）。
 * 呼び出し側は「適用済みのためスキップ」として扱ってよい。
 * エラーメッセージの文言に依存せず型で判別できるよう、専用型として切り出している。
 */
export class UnpaidSettlementAlreadyAppliedError extends InvariantViolationError {}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`)
  }
}

export class PermissionDeniedError extends DomainError {}
