import { z } from 'zod'
import { MoneySchema } from '../../shared/value-objects/Money'

/**
 * 上限設定値（上限あり OR 無制限。月次上限イベントのペイロード用）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 */
export const SeedLimitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('capped'), capAmount: MoneySchema }),
  z.object({ kind: z.literal('unlimited') }),
])
export type SeedLimit = z.infer<typeof SeedLimitSchema>
