/**
 * ニックネーム値オブジェクト（Phase 3.5 追加）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * - 10 文字以内（Phase 3.5 目安）
 * - 省略可（利用側で `.optional()`）。未設定時は役割名（Honey / Darling）で表示するが、
 *   表示フォールバックは UI 関心のためドメインでは扱わない
 * - 世帯共有の表示（妻の変更が夫の画面にも反映）だが、変更は本人のみ可
 */
import { z } from 'zod'

export const NicknameSchema = z.string().min(1).max(10).brand<'Nickname'>()
export type Nickname = z.infer<typeof NicknameSchema>
