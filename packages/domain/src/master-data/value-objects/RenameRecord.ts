import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'

/**
 * 改名履歴レコード
 * @see docs/domain/08h-ul-マスタ管理.md §1
 */
export const RenameRecordSchema = z.object({
  oldName: z.string().min(1),
  newName: z.string().min(1),
  renamedAt: z.date(),
  renamedByUserId: UserIdSchema,
})
export type RenameRecord = z.infer<typeof RenameRecordSchema>
