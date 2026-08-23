/**
 * 手入力に添えるメモ（残高・資産推移管理コンテキスト、#459 / #458）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * kawasima: data メモ = 文字列
 *
 * 別銀行貯蓄の手入力記録（`OtherSavingsManualEntry`）と NISA の手入力記録
 * （`NisaManualEntry`）が共有する制約のため、独立した値オブジェクトとして置く。
 * どちらか一方のファイルに同居させると「別銀行貯蓄のもの」に見え、軸が増えるたびに
 * 横断 import が積み増す。
 *
 * 空文字・空白のみは「書いていない」と区別が付かないため許さず（未記入は項目ごと省く）、
 * 前後の空白を取り除いた実質が 1 文字以上あることを求める。上限は口座 payload に恒久的に
 * 積み上がる自由入力のため、非アクティブ理由（100）より広めに置きつつ有限にする
 * （前後の空白を含めた入力長で数える）。
 */
import { z } from 'zod'

export const ManualEntryMemoSchema = z
  .string()
  .max(200)
  .refine(v => v.trim().length > 0, { message: 'メモは空白のみにできない' })
export type ManualEntryMemo = z.infer<typeof ManualEntryMemoSchema>
