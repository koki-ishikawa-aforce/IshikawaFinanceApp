/**
 * queryDeps（コンテキスト外 Read データ）のテスト用スタブ
 */
import type { UserId, UserRole } from '@warimaru/domain'
import type { ResolveCategoryNames, ResolveViewerRole } from '../../src/queryDeps'
import { DARLING_USER_ID, HONEY_USER_ID } from './fixtures'

/** 与えた対応表にある ID だけ解決する（未知 ID は Map に含めない） */
export function stubResolveCategoryNames(known: Record<string, string> = {}): ResolveCategoryNames {
  return ids =>
    Promise.resolve(new Map(ids.filter(id => id in known).map(id => [id, known[id] ?? ''])))
}

export const stubResolveViewerRole: ResolveViewerRole = (viewerId: UserId) => {
  const role: UserRole | null =
    viewerId === HONEY_USER_ID ? 'honey' : viewerId === DARLING_USER_ID ? 'darling' : null
  if (role === null) {
    return Promise.reject(new Error(`未知の viewerId: ${viewerId}`))
  }
  return Promise.resolve(role)
}
