import type {
  BrokerageNameWire,
  ExpenseClassWire,
  OwnAccountWire,
  UnclassifiedReasonWire,
} from './api-schemas'

export const EXPENSE_CLASS_LABELS: Record<ExpenseClassWire, string> = {
  household: '世帯',
  personal_honey: '個人(Honey)',
  personal_darling: '個人(Darling)',
  business_expense: '経費(会社)',
}

export function expenseClassLabel(expenseClass: ExpenseClassWire): string {
  return EXPENSE_CLASS_LABELS[expenseClass]
}

// ---------- 自動分類・学習（#402: 一括分類セッション） ----------

/**
 * 未分類理由の表示文言。「なぜ分類されなかったか」を利用者の言葉で示す
 * （`docs/domain/08b-ul-自動分類学習.md` の未分類理由に 1:1 対応）。
 */
export const UNCLASSIFIED_REASON_LABELS: Record<UnclassifiedReasonWire, string> = {
  merchant_rule_unlearned: 'この店舗はまだ学習していません',
  amazon_product_key_unlearned: 'Amazon の商品がまだ学習されていません',
  amazon_product_info_undecidable: 'Amazon の商品を特定できませんでした',
  amazon_match_timeout: 'Amazon の注文と結び付けられませんでした',
  learning_disabled: 'この店舗は学習しない設定です',
}

export function unclassifiedReasonLabel(reason: UnclassifiedReasonWire): string {
  return UNCLASSIFIED_REASON_LABELS[reason]
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
