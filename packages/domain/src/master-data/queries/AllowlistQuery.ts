/**
 * 許可リスト参照 Query I/F（オンボーディング・認証の役割判定が読む）
 * @see docs/domain/08h-ul-マスタ管理.md §2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 */
import type { Allowlist } from '../value-objects/Allowlist'

export interface AllowlistQuery {
  fetch(): Promise<Allowlist>
}
