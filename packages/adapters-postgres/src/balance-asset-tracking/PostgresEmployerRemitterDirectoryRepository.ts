/**
 * EmployerRemitterDirectoryRepository の PostgreSQL 実装（#448 / OQ-61）
 *
 * 名簿は追記しかされない（登録を取り消す振る舞いは 08d に無い）。save は集約が持つ
 * 登録をまとめて挿入し、既にある行は衝突時に無視する。上書きにしないのは、同じ用途での
 * 確定し直し（反映の前方回復）で save が再び走っても登録日時と表示用の名前を
 * 初回のまま据え置くため。
 *
 * findByOwner は 1 件も登録が無ければ空の名簿を返す（Repository I/F の約束）。
 */
import { asc, eq } from 'drizzle-orm'
import { emptyEmployerRemitterDirectory, EmployerRemitterDirectorySchema } from '@warimaru/domain'
import type {
  EmployerRemitterDirectory,
  EmployerRemitterDirectoryRepository,
  UserId,
} from '@warimaru/domain'
import type { Db } from '../client'
import { employerRemitterNames } from '../schema'

export class PostgresEmployerRemitterDirectoryRepository implements EmployerRemitterDirectoryRepository {
  constructor(private readonly db: Db) {}

  async findByOwner(userId: UserId): Promise<EmployerRemitterDirectory> {
    const rows = await this.db
      .select({
        normalizedName: employerRemitterNames.normalizedName,
        displayName: employerRemitterNames.displayName,
        registeredAt: employerRemitterNames.registeredAt,
        sourceTransactionId: employerRemitterNames.sourceTransactionId,
      })
      .from(employerRemitterNames)
      .where(eq(employerRemitterNames.userId, userId))
      .orderBy(asc(employerRemitterNames.registeredAt), asc(employerRemitterNames.normalizedName))
    if (rows.length === 0) return emptyEmployerRemitterDirectory(userId)
    return EmployerRemitterDirectorySchema.parse({ userId, entries: rows })
  }

  async save(directory: EmployerRemitterDirectory): Promise<void> {
    if (directory.entries.length === 0) return
    await this.db
      .insert(employerRemitterNames)
      .values(
        directory.entries.map(e => ({
          userId: directory.userId,
          normalizedName: e.normalizedName,
          displayName: e.displayName,
          registeredAt: e.registeredAt,
          sourceTransactionId: e.sourceTransactionId,
        })),
      )
      .onConflictDoNothing({
        target: [employerRemitterNames.userId, employerRemitterNames.normalizedName],
      })
  }
}
