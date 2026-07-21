import type { PersonalExpenseClass, UserRole } from '@warimaru/domain'

/** ロール → 個人費目区分（未分類取引の既定区分・按分子取引の個人区分に使用） */
export function roleToPersonalExpenseClass(role: UserRole): PersonalExpenseClass {
  return role === 'honey' ? 'personal_honey' : 'personal_darling'
}
