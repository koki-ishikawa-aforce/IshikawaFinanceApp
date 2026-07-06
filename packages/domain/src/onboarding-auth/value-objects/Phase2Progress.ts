/**
 * Phase 2 進捗（Section A〜F）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * 論点8: A / B は必須かつ順序強制（A 完了後でなければ B に進めない — AppUser 側の superRefine）。
 * C / D / E は確認のみでも可、F はスキップ可。
 */
import { z } from 'zod'
import { ImportJobIdSchema } from '../../shared/ids'
import { ParameterStorePathSchema } from '../../shared/value-objects/ParameterStorePath'
import { InitialBalanceRegistrationRefSchema } from './InitialBalanceRegistrationRef'

export const SectionAProgressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_started') }),
  z.object({
    kind: z.literal('completed'),
    tokenStoreRef: ParameterStorePathSchema,
    completedAt: z.date(),
  }),
])
export type SectionAProgress = z.infer<typeof SectionAProgressSchema>

export const SectionBProgressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_started') }),
  z.object({
    kind: z.literal('completed'),
    initialBalanceRef: InitialBalanceRegistrationRefSchema,
    completedAt: z.date(),
  }),
])
export type SectionBProgress = z.infer<typeof SectionBProgressSchema>

export const SectionCProgressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unconfirmed') }),
  z.object({ kind: z.literal('confirmed'), confirmedAt: z.date() }),
  z.object({
    kind: z.literal('edited'),
    editedAt: z.date(),
    editCount: z.number().int().positive(),
  }),
])
export type SectionCProgress = z.infer<typeof SectionCProgressSchema>

export const SectionDProgressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unconfirmed') }),
  z.object({ kind: z.literal('confirmed'), confirmedAt: z.date() }),
  z.object({
    kind: z.literal('edited'),
    editedAt: z.date(),
    editCount: z.number().int().positive(),
  }),
])
export type SectionDProgress = z.infer<typeof SectionDProgressSchema>

export const SectionEProgressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unconfirmed') }),
  z.object({ kind: z.literal('confirmed'), confirmedAt: z.date() }),
  z.object({
    kind: z.literal('changed'),
    changedAt: z.date(),
    changeCount: z.number().int().positive(),
  }),
])
export type SectionEProgress = z.infer<typeof SectionEProgressSchema>

export const SectionFProgressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_started') }),
  z.object({ kind: z.literal('skipped'), skippedAt: z.date() }),
  z.object({
    kind: z.literal('completed'),
    importJobId: ImportJobIdSchema,
    completedAt: z.date(),
  }),
])
export type SectionFProgress = z.infer<typeof SectionFProgressSchema>

export const Phase2ProgressSchema = z.object({
  sectionA: SectionAProgressSchema,
  sectionB: SectionBProgressSchema,
  sectionC: SectionCProgressSchema,
  sectionD: SectionDProgressSchema,
  sectionE: SectionEProgressSchema,
  sectionF: SectionFProgressSchema,
})
export type Phase2Progress = z.infer<typeof Phase2ProgressSchema>
