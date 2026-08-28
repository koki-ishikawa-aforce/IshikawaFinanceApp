/**
 * アクセス拒否カウンタ（見知らぬ相手からのアクセス拒否を LINE_userID ごとに集約する）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 *
 * 同じ相手からの拒否は 1 件へ集約する（連続失敗カウンタと同じ考え方）。個々の発生時刻の
 * 履歴は残さず、累計回数・最終発生日時のみを保持する（Issue #651 決定 A-1）。
 */
import { z } from 'zod'
import { UserIdSchema, type UserId } from '../../shared/ids'

export const AccessDenialCounterSchema = z.object({
  lineUserId: UserIdSchema,
  deniedCount: z.number().int().positive(),
  lastDeniedAt: z.date(),
})
export type AccessDenialCounter = z.infer<typeof AccessDenialCounterSchema>

/** 拒否を1件記録する（既存カウンタが無ければ1件目として作る。累計回数を+1し、最終発生日時を更新する） */
export function recordAccessDenial(
  existing: AccessDenialCounter | null,
  lineUserId: UserId,
  deniedAt: Date,
): AccessDenialCounter {
  return AccessDenialCounterSchema.parse({
    lineUserId,
    deniedCount: (existing?.deniedCount ?? 0) + 1,
    lastDeniedAt: deniedAt,
  })
}
