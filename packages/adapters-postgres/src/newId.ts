/**
 * 内部発番 ID の生成（OQ-41: ULID 採用）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §2.3
 *
 * 生成は adapter 層の責務。ドメイン層は生成済み文字列を受け取るのみ。
 * 第 1 波では save は構築済み集約を受け取るため、本関数は主にテスト
 * フィクスチャと第 2 波以降のファクトリで使う。
 */
import { ulid } from 'ulid'

export function newUlid(): string {
  return ulid()
}
