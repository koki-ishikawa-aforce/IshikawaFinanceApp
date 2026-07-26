import type {
  BrokerageNameWire,
  ExpenseClassWire,
  LearningRefsWire,
  OwnAccountWire,
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

// ---------- 分類学習ルール（#400） ----------

/** 学習ルールが覚えている 1 軸ぶんの表示。`learned` が false のとき `value` は未学習の案内文 */
export interface LearnedAxisLabel {
  axis: string
  value: string
  learned: boolean
}

const UNLEARNED_LABEL = 'まだ覚えていません'

/** マスタ名を引けないときの表示。カテゴリ・経費種別の削除は付け替えを伴うため通常は起きない */
const UNKNOWN_MASTER_LABEL = '（不明）'

/**
 * 学習ルールが軸ごとに覚えている内容を表示用ラベルへ変換する。
 *
 * 3 軸（カテゴリ / 費用区分 / 経費種別）は独立に学習される（T-2）ため、学習済みの軸だけを
 * 抜き出さず常に 3 軸すべてを返し、未学習の軸も「まだ覚えていません」として見せる。
 * 「未学習の軸が残るルールは自動分類に使えない」という判定はドメインの不変条件なので、
 * ここでは再実装せず素の状態のみを表示する。
 */
export function learnedAxisLabels(
  refs: LearningRefsWire,
  categoryNameOf: (categoryId: string) => string | undefined,
  expenseTypeNameOf: (expenseTypeId: string) => string | undefined,
): LearnedAxisLabel[] {
  return [
    {
      axis: 'カテゴリ',
      ...(refs.categoryRef.kind === 'learned'
        ? {
            value: categoryNameOf(refs.categoryRef.categoryId) ?? UNKNOWN_MASTER_LABEL,
            learned: true,
          }
        : { value: UNLEARNED_LABEL, learned: false }),
    },
    {
      axis: '費用区分',
      ...(refs.expenseClassRef.kind === 'learned'
        ? { value: EXPENSE_CLASS_LABELS[refs.expenseClassRef.expenseClass], learned: true }
        : { value: UNLEARNED_LABEL, learned: false }),
    },
    {
      axis: '経費種別',
      ...(refs.expenseTypeRef.kind === 'learned'
        ? {
            value: expenseTypeNameOf(refs.expenseTypeRef.expenseTypeId) ?? UNKNOWN_MASTER_LABEL,
            learned: true,
          }
        : { value: UNLEARNED_LABEL, learned: false }),
    },
  ]
}
