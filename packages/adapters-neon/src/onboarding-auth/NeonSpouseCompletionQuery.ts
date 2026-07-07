/**
 * SpouseCompletionQuery の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 「完了」= Phase2 完了以降（phase2_completed / operation_started）。
 * 両者完了なら both_completed（bothCompletedAt = 遅い方の phase2CompletedAt）、
 * そうでなければ awaiting_spouse。配偶者の app_users 行が未登録の場合は
 * DB から spouseUserId が取れないため、注入された許可リスト解決で補う
 * （論点19: 画面ロード時のみ判定するため 2 行の全読みで足りる）。
 */
import type {
  Allowlist,
  AppUser,
  SpouseCompletionQuery,
  SpouseCompletionResult,
  UserId,
} from '@warimaru/domain'
import {
  AppUserSchema,
  InvariantViolationError,
  SpouseCompletionResultSchema,
} from '@warimaru/domain'
import type { Db } from '../client'
import { appUsers } from '../schema'
import { parsePayload } from '../serialize'

export interface NeonSpouseCompletionQueryDeps {
  /** 配偶者行が未登録のとき spouseUserId を補う（NeonAllowlistQuery.fetch を渡す） */
  fetchAllowlist: () => Promise<Allowlist>
  /** awaiting_spouse.detectedAt に使う現在時刻（テスト決定性のため注入） */
  now: () => Date
}

type CompletedUser = Extract<AppUser, { kind: 'phase2_completed' | 'operation_started' }>

function asCompleted(user: AppUser | undefined): CompletedUser | null {
  if (user === undefined) return null
  return user.kind === 'phase2_completed' || user.kind === 'operation_started' ? user : null
}

export class NeonSpouseCompletionQuery implements SpouseCompletionQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: NeonSpouseCompletionQueryDeps,
  ) {}

  async check(viewerId: UserId): Promise<SpouseCompletionResult> {
    const rows = await this.db.select({ payload: appUsers.payload }).from(appUsers)
    const users = rows.map(row => parsePayload(AppUserSchema, row.payload))
    const viewer = users.find(u => u.common.userId === viewerId)
    const spouse = users.find(u => u.common.userId !== viewerId)

    const viewerCompleted = asCompleted(viewer)
    const spouseCompleted = asCompleted(spouse)
    if (viewerCompleted !== null && spouseCompleted !== null) {
      const [honey, darling] =
        viewerCompleted.common.role === 'honey'
          ? [viewerCompleted, spouseCompleted]
          : [spouseCompleted, viewerCompleted]
      return SpouseCompletionResultSchema.parse({
        kind: 'both_completed',
        honeyUserId: honey.common.userId,
        darlingUserId: darling.common.userId,
        bothCompletedAt: new Date(
          Math.max(
            viewerCompleted.phase2CompletedAt.getTime(),
            spouseCompleted.phase2CompletedAt.getTime(),
          ),
        ),
      })
    }

    const spouseUserId = spouse?.common.userId ?? (await this.resolveSpouseFromAllowlist(viewerId))
    return SpouseCompletionResultSchema.parse({
      kind: 'awaiting_spouse',
      userId: viewerId,
      spouseUserId,
      detectedAt: this.deps.now(),
    })
  }

  private async resolveSpouseFromAllowlist(viewerId: UserId): Promise<UserId> {
    const allowlist = await this.deps.fetchAllowlist()
    if (allowlist.honeyLineUserId === viewerId) return allowlist.darlingLineUserId
    if (allowlist.darlingLineUserId === viewerId) return allowlist.honeyLineUserId
    throw new InvariantViolationError(`viewer ${viewerId} は許可リストに含まれていない`)
  }
}
