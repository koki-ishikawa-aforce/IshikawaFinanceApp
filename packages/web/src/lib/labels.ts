import type { BrokerageNameWire, ExpenseClassWire, OwnAccountWire } from './api-schemas'

export const EXPENSE_CLASS_LABELS: Record<ExpenseClassWire, string> = {
  household: '世帯',
  personal_honey: '個人(Honey)',
  personal_darling: '個人(Darling)',
  business_expense: '経費(会社)',
}

export function expenseClassLabel(expenseClass: ExpenseClassWire): string {
  return EXPENSE_CLASS_LABELS[expenseClass]
}

// ---------- 設定（#48: 口座管理） ----------

export const ACCOUNT_KIND_LABELS: Record<OwnAccountWire['kind'], string> = {
  smbc_bank: 'SMBC銀行口座',
  mitsui_sumitomo_card: '三井住友カード',
  other_savings: '別銀行貯蓄口座',
  nisa: 'NISA口座',
}

export function brokerageNameLabel(name: BrokerageNameWire): string {
  switch (name.kind) {
    case 'sbi':
      return 'SBI証券'
    case 'rakuten':
      return '楽天証券'
    case 'other':
      return name.customName
  }
}
