/**
 * 一括分類セッション Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * 進行中セッションの二重起動防止は findInProgressByUser で保証する（Phase 5 M-B）。
 *
 * 版数照合（楽観ロック、#609）: 渡されたセッションの `common.version` が保存先の現在の版と
 * 一致するときだけ書き込み、一致しなければ**書き込まずに** `ConcurrentUpdateError` を
 * throw する。進捗は「読み出して → 書き換えて → まるごと保存し直す」形で更新するため、
 * 照合が無いと、読み出しから保存までの間に入った他の更新（別端末からの進捗記録など）を
 * 後から保存した側が黙って消す。呼び出し側はこの失敗を握りつぶさず、やり直せば通ることが
 * 分かる形で利用者へ返すこと。
 *
 * 実装は「版数が一致する行だけを更新し、更新できた行が無ければ拒否とみなす」形で書く。
 * 先に読んで比べてから書くと、その間に別の更新が入る隙が残る。
 */
import type { BulkClassificationSessionId, UserId } from '../../shared/ids'
import type { BulkClassificationSession } from '../aggregates/BulkClassificationSession'

export interface BulkClassificationSessionRepository {
  findById(id: BulkClassificationSessionId): Promise<BulkClassificationSession | null>
  findInProgressByUser(userId: UserId): Promise<BulkClassificationSession | null>
  save(session: BulkClassificationSession): Promise<void>
}
