/**
 * 口座集約の永続化 I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.3
 */
import type { AccountId, UserId } from '../../shared/ids'
import type { Account } from '../aggregates/Account'

export interface AccountRepository {
  findById(id: AccountId): Promise<Account | null>
  findByOwner(ownerId: UserId): Promise<Account[]>
  /**
   * 集約の不変条件「同一ユーザー × 口座種別の一意性」は集約境界をまたぐため、
   * Repository.save 時の重複チェック方法は Phase 5 で確定する。
   * 違反は `InvariantViolationError`。
   *
   * 版数照合（楽観ロック、#459）: 渡された口座の `common.version` が保存先の現在の版と
   * 一致するときだけ書き込み、一致しなければ**書き込まずに** `ConcurrentUpdateError` を
   * throw する。口座は「読み出して → 書き換えて → まるごと保存し直す」形で更新するため、
   * 照合が無いと、読み出しから保存までの間に入った他の更新（メール取込による引落の反映など）を
   * 後から保存した側が黙って消す。呼び出し側はこの失敗を握りつぶさず、やり直せば通ることが
   * 分かる形で利用者へ返すこと。
   *
   * 実装は「版数が一致する行だけを更新し、更新できた行が無ければ拒否とみなす」形で書く。
   * 先に読んで比べてから書くと、その間に別の更新が入る隙が残る。
   */
  save(account: Account): Promise<void>
}
