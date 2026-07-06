import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** SectionC/D/E 確認イベント（08f §3。確認のみでも可の Section） */
export const SectionIdentifierSchema = z.enum(['section_c', 'section_d', 'section_e'])
export type SectionIdentifier = z.infer<typeof SectionIdentifierSchema>

export const SectionConfirmedSchema = DomainEventBaseSchema.extend({
  type: z.literal('SectionConfirmed'),
  userId: UserIdSchema,
  section: SectionIdentifierSchema,
  confirmedAt: z.date(),
})
export type SectionConfirmed = z.infer<typeof SectionConfirmedSchema>
