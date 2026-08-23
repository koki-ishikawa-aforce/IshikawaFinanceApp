/**
 * NISA積立累計の手入力記録（残高・資産推移管理コンテキスト、#458）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * kawasima:
 *   data NISA積立補正手入力 = 入力者ユーザーID AND 補正前累計 AND 補正後累計 AND 入力日時 AND メモ?
 *
 * 08d §1 の `NISA積立累計更新` のうち手入力由来の 1 種。振込由来の加算（NISA積立加算）は
 * 取引 1 件と 1 対 1 で取引から辿れるため含めない（別銀行貯蓄の手入力記録
 * `OtherSavingsManualEntry` と同じ切り分け）。
 *
 * 判別子は別銀行貯蓄の残高補正と同じ `manual_correction` を使う。同じ「実際の値を入れ直す」
 * 操作を軸ごとに別の語で呼ぶと、記録を突き合わせるときに語彙が割れるため。
 * メモの制約も別銀行貯蓄と同じ `ManualEntryMemoSchema` を借りる（口座 payload に恒久的に
 * 積み上がる自由入力という性質が同じで、軸ごとに上限が違う理由が無い）。
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { ManualEntryMemoSchema } from './ManualEntryMemo'

export const NisaManualEntrySchema = z.object({
  kind: z.literal('manual_correction'),
  enteredByUserId: UserIdSchema,
  /** 補正前の積立累計。差分ではなく前後の値を残す（08d §1） */
  accumulatedBefore: MoneySchema,
  accumulatedAfter: MoneySchema,
  enteredAt: z.date(),
  memo: ManualEntryMemoSchema.optional(),
})
export type NisaManualEntry = z.infer<typeof NisaManualEntrySchema>
