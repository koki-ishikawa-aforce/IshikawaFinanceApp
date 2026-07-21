import type { DomainEvent, EventBus, EventHandler } from '@warimaru/domain'

/**
 * ハンドラー例外を隔離して subscribe する。
 *
 * イベント発行元の主処理（集約の保存）はハンドラー実行前に完了しているため、
 * ハンドラー失敗で API リクエストごと失敗させず、ログに残して継続する
 * （#34: 同期・インプロセス配信のエラー方針）。取りこぼした反映は
 * 同一操作の再実行（イベントの再発行）で回復できる。
 */
export function safeSubscribe<E extends DomainEvent>(
  eventBus: EventBus,
  eventType: E['type'],
  handler: EventHandler<E>,
): void {
  eventBus.subscribe<E>(eventType, async event => {
    try {
      await handler(event)
    } catch (error) {
      console.error(`event handler failed: ${event.type} (eventId=${event.eventId})`, error)
    }
  })
}
