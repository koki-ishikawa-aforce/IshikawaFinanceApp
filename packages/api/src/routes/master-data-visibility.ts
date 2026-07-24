import { PermissionDeniedError } from '@warimaru/domain'
import type { CategoryMaster, ExpenseTypeMaster, UserId } from '@warimaru/domain'

/**
 * 削除リマップの移動先マスタが閲覧者に見えるか検証する。
 * 世帯共有マスタ、または本人の個人別マスタのみ移動先として許容し、
 * 他ユーザーの個人別マスタは移動先にできない。
 * カテゴリ削除・経費種別削除の両ルートで共有する。
 */
export function assertVisibleToViewer(
  master: CategoryMaster | ExpenseTypeMaster,
  viewerId: UserId,
  label: string,
): void {
  if (master.scope.kind === 'personal' && master.scope.userId !== viewerId) {
    throw new PermissionDeniedError(`他ユーザーの${label}は移動先にできない`)
  }
}
