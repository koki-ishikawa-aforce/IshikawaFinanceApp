/**
 * ResolveViewerRole の実 DB 実装
 *
 * 第 1 波では関数注入のスタブだった queryDeps を app_users の
 * 実テーブル読みに差し替える（queryDeps.ts の予告どおり。Query 実装側は無変更）。
 */
import { eq } from 'drizzle-orm'
import { NotFoundError, UserRoleSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { appUsers } from '../schema'
import type { ResolveViewerRole } from '../queryDeps'

export function createDbResolveViewerRole(db: Db): ResolveViewerRole {
  return async viewerId => {
    const rows = await db
      .select({ role: appUsers.role })
      .from(appUsers)
      .where(eq(appUsers.userId, viewerId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      throw new NotFoundError('AppUser', viewerId)
    }
    return UserRoleSchema.parse(row.role)
  }
}
