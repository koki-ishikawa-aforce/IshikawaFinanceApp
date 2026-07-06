/**
 * Phase0 設定値 Repository I/F（システム全体で 1 件）
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 */
import type { Phase0Config } from '../aggregates/Phase0Config'

export interface Phase0ConfigRepository {
  find(): Promise<Phase0Config | null>
  save(config: Phase0Config): Promise<void>
}
