import type {
  BrokerageNameWire,
  ExpenseClassWire,
  LearningRefsWire,
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

/**
 * 口座種別の表示順（08d §1「口座種別 = SMBC銀行 OR 三井住友カード OR 別銀行貯蓄 OR NISA」）。
 * 登録の導線（設定 > 口座、はじめての設定 Section B）で、未登録の種別を毎回同じ並びで出すために使う。
 */
export const ACCOUNT_KIND_ORDER: OwnAccountWire['kind'][] = [
  'smbc_bank',
  'mitsui_sumitomo_card',
  'other_savings',
  'nisa',
]

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

/**
 * 学習の 3 軸（08b §3 の更新軸。domain の `LearningAxis` と同じ集合）。
 * 表示名は下の LEARNING_AXIS_LABELS が持ち、識別子と表示文字列を混ぜない。
 */
export type LearningAxisKey = 'category' | 'expense_class' | 'expense_type'

export const LEARNING_AXIS_LABELS: Record<LearningAxisKey, string> = {
  category: 'カテゴリ',
  expense_class: '費用区分',
  expense_type: '経費種別',
}

/** 学習ルールが覚えている 1 軸ぶんの表示。`learned` が false のとき `value` は未学習の案内文 */
export interface LearnedAxisLabel {
  axis: LearningAxisKey
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
      axis: 'category',
      ...(refs.categoryRef.kind === 'learned'
        ? {
            value: categoryNameOf(refs.categoryRef.categoryId) ?? UNKNOWN_MASTER_LABEL,
            learned: true,
          }
        : { value: UNLEARNED_LABEL, learned: false }),
    },
    {
      axis: 'expense_class',
      ...(refs.expenseClassRef.kind === 'learned'
        ? { value: EXPENSE_CLASS_LABELS[refs.expenseClassRef.expenseClass], learned: true }
        : { value: UNLEARNED_LABEL, learned: false }),
    },
    {
      axis: 'expense_type',
      ...(refs.expenseTypeRef.kind === 'learned'
        ? {
            value: expenseTypeNameOf(refs.expenseTypeRef.expenseTypeId) ?? UNKNOWN_MASTER_LABEL,
            learned: true,
          }
        : { value: UNLEARNED_LABEL, learned: false }),
    },
  ]
}
