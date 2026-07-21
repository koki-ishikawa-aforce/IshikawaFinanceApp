import type { ExpenseClassWire } from './api-schemas'

export const EXPENSE_CLASS_LABELS: Record<ExpenseClassWire, string> = {
  household: '世帯',
  personal_honey: '個人(Honey)',
  personal_darling: '個人(Darling)',
  business_expense: '経費(会社)',
}

export function expenseClassLabel(expenseClass: ExpenseClassWire): string {
  return EXPENSE_CLASS_LABELS[expenseClass]
}
