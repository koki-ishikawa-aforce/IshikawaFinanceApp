/**
 * SpouseCompletionQuery の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 判定規約（「完了」= Phase2 完了以降、両者完了なら both_completed 等）は
 * ドメイン関数 `detectSpouseCompletion` に集約されている。本実装は app_users の
 * 全読み（論点19: 画面ロード時のみ判定するため 2 行の全読みで足りる）と、
 * 配偶者行が未登録のときの許可リスト解決だけを担う。
 */
import type {
  Allowlist,
  SpouseCompletionQuery,
  SpouseCompletionResult,
  UserId,
} from '@warimaru/domain'
import { AppUserSchema, detectSpouseCompletion, resolveSpouseUserId } from '@warimaru/domain'
import type { Db } from '../client'
import { appUsers } from '../schema'
import { parsePayload } from '../serialize'

export interface NeonSpouseCompletionQueryDeps {
  /** 配偶者行が未登録のとき spouseUserId を補う（NeonAllowlistQuery.fetch を渡す） */
  fetchAllowlist: () => Promise<Allowlist>
  /** awaiting_spouse.detectedAt に使う現在時刻（テスト決定性のため注入） */
  now: () => Date
}

export class NeonSpouseCompletionQuery implements SpouseCompletionQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: NeonSpouseCompletionQueryDeps,
  ) {}

  async check(viewerId: UserId): Promise<SpouseCompletionResult> {
    const rows = await this.db.select({ payload: appUsers.payload }).from(appUsers)
    const users = rows.map(row => parsePayload(AppUserSchema, row.payload))
    return detectSpouseCompletion(viewerId, users, {
      resolveSpouseUserId: async () =>
        resolveSpouseUserId(viewerId, await this.deps.fetchAllowlist()),
      now: this.deps.now,
    })
  }
}
