import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'
import { NicknameSchema } from '../value-objects/Nickname'

/** ニックネーム変更イベント（08f §3、Phase 3.5。旧/新とも未設定を許容） */
export const NicknameChangedSchema = DomainEventBaseSchema.extend({
  type: z.literal('NicknameChanged'),
  userId: UserIdSchema,
  oldNickname: NicknameSchema.optional(),
  newNickname: NicknameSchema.optional(),
})
export type NicknameChanged = z.infer<typeof NicknameChangedSchema>
