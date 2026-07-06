/**
 * 取引候補の取込ソース（shared ImportSource のサブセット再構成）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * 取引候補は CSV手動マージ由来（csv_merge）を持たない（マージは家計分析側の取引操作）ため、
 * shared のメンバー schema から 5 種で再構成する。
 */
import { z } from 'zod'
import {
  ImportSourceEmailSchema,
  ImportSourceCsvSchema,
  ImportSourcePdfSchema,
  ImportSourceAmazonMatchSchema,
  ImportSourceManualSchema,
} from '../../shared/value-objects/ImportSource'

export const CandidateImportSourceSchema = z.discriminatedUnion('kind', [
  ImportSourceEmailSchema,
  ImportSourceCsvSchema,
  ImportSourcePdfSchema,
  ImportSourceAmazonMatchSchema,
  ImportSourceManualSchema,
])
export type CandidateImportSource = z.infer<typeof CandidateImportSourceSchema>
