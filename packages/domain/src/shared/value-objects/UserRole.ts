/**
 * ユーザー役割 enum
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 *
 * kawasima: data 役割 = Honey OR Darling
 *
 * Phase 3.5 で夫役割→Honey / 妻役割→Darling に改称。
 * Parameter Store キーは互換のため HUSBAND_LINE_USER_ID / WIFE_LINE_USER_ID を維持（08h）。
 */
import { z } from 'zod'

export const UserRoleSchema = z.enum(['honey', 'darling'])
export type UserRole = z.infer<typeof UserRoleSchema>
