import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ImportJobIdSchema, UserIdSchema } from '../../shared/ids'
import { StatementFileKindSchema } from '../aggregates/StatementImportJob'

/** ファイルアップロードイベント（08a §3） */
export const FileUploadedSchema = DomainEventBaseSchema.extend({
  type: z.literal('FileUploaded'),
  importJobId: ImportJobIdSchema,
  userId: UserIdSchema,
  fileKind: StatementFileKindSchema,
})
export type FileUploaded = z.infer<typeof FileUploadedSchema>
