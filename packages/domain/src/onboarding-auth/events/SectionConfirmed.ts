import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'
import { SectionIdentifierSchema } from '../value-objects/Phase2Progress'

/** SectionC/D/E 確認イベント（08f §3。確認のみでも可の Section） */
export const SectionConfirmedSchema = DomainEventBaseSchema.extend({
  type: z.literal('SectionConfirmed'),
  userId: UserIdSchema,
  section: SectionIdentifierSchema,
  confirmedAt: z.date(),
})
export type SectionConfirmed = z.infer<typeof SectionConfirmedSchema>
