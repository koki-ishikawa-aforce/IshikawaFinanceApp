import type { DomainEventBase } from './DomainEvent'

export type DomainEvent = DomainEventBase & { readonly type: string }

/**
 * イベントハンドラー。Repository 呼び出し等の非同期処理を行えるよう
 * Promise 返却を許容する（#34: 同期・インプロセス配信の設計判断）。
 */
export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>

/**
 * ドメインイベントバス（driven port）。
 *
 * 配信方式は同期・インプロセス: publish は登録済みハンドラーを登録順に
 * 直列実行し、全ハンドラーの完了を待って解決する。配信は at-least-once
 * （API リクエストの再実行で同一イベントが再発行されうる）ため、
 * ハンドラーは冪等に実装する。
 */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>
  subscribe<E extends DomainEvent>(eventType: E['type'], handler: EventHandler<E>): void
  clear(): void
}
