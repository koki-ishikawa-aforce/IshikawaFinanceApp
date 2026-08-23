/**
 * employer_remitter_names テーブル（集約 EmployerRemitterDirectory 勤務先振込元名簿、#448 / OQ-61）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/03-open-questions.md OQ-61
 *
 * 名簿は利用者ごと（OQ-61 ②: 夫婦が別々の勤務先でも成り立つ形で持つ）。1 登録 = 1 行で、
 * PK (user_id, normalized_name) が集約の不変条件「正規化済み振込元名で一意」の最終保証。
 * 同じ勤務先を二度登録しても行が増えず、登録日時も上書きされない（挿入は衝突時に無視する）。
 *
 * 名簿の読み出しは常に所有者本人ぶんに絞るため（プライバシー3段階ルール）、
 * user_id が PK の先頭に来る形で足りる。追加の索引は置かない。
 */
import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'

export const employerRemitterNames = pgTable(
  'employer_remitter_names',
  {
    userId: text('user_id').notNull(),
    /** 照合に使う正規化済みの名前（NFKC + 長音統一 + 空白圧縮、OQ-7） */
    normalizedName: text('normalized_name').notNull(),
    /** 明細に載っていた生の表記。利用者が自分の明細と突き合わせるための表示用 */
    displayName: text('display_name').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** 登録のもとになった入金の取引ID */
    sourceTransactionId: text('source_transaction_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.userId, t.normalizedName] })],
)
