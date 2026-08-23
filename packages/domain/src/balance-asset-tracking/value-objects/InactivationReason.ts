/**
 * 非アクティブ理由（08d §1「非アクティブ = 非アクティブ化日時 AND 非アクティブ理由」）
 *
 * 空文字は許さない（何のために閉じたかが残らないため）。上限は口座 payload・イベント
 * payload に恒久的に載る自由入力のため BankName（50）に倣う。
 *
 * 口座集約（非アクティブ化の入力）と口座非アクティブ化 / 再アクティブ化イベントの双方が
 * 参照する単一ソース。片方だけ緩いと、集約に保存できた理由がイベントの検証で弾かれる
 * （またはその逆の）ずれが生まれる。
 *
 * 注意: 集約の `ActivenessSchema.reason` にはこの下限を課していない。既存データを
 * 読めなくしないためで、読み出しは `z.string()`、書き込みはこのスキーマで検証する。
 */
import { z } from 'zod'

export const InactivationReasonSchema = z.string().min(1).max(100)
export type InactivationReason = z.infer<typeof InactivationReasonSchema>
