/**
 * 口座の見せ方に関わる規則（残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * 「口座の表示名」と「残高の手入力を受け付ける口座か」は、残高一覧（`AccountBalanceQuery`）と
 * 口座詳細（`AccountDetailQuery`）の両方が必要とする。Query 実装ごとに書くと、
 * 片方だけ直したときに一覧と詳細で違う名前・違うボタンが出る。
 */
import type { Account } from '../aggregates/Account'
import { brokerageNameToDisplay } from '../value-objects/BrokerageName'

/** 三井住友系の固定名（利用者が変更できない）。View スキーマのリテラルと同じ値を持つ */
export const SMBC_BANK_DISPLAY_NAME = '三井住友銀行'
export const MITSUI_SUMITOMO_CARD_DISPLAY_NAME = '三井住友カード'

/**
 * 画面に出す口座の名前。三井住友系は固定名（利用者が変更できない）で、
 * 別銀行貯蓄は登録した銀行名、NISA は証券会社名。
 */
export function accountDisplayName(account: Account): string {
  switch (account.kind) {
    case 'smbc_bank':
      return SMBC_BANK_DISPLAY_NAME
    case 'mitsui_sumitomo_card':
      return MITSUI_SUMITOMO_CARD_DISPLAY_NAME
    case 'other_savings':
      return account.bankName
    case 'nisa':
      return brokerageNameToDisplay(account.brokerageName)
  }
}

/**
 * 残高の手入力（08d §1 の手入力種別 = 取り崩し記録 OR 残高補正）を受け付ける口座か。
 *
 * 対象は別銀行貯蓄だけ。三井住友系は取込が自動で更新し、NISA が受け付けるのは
 * 積立累計の補正（#458）で、残高の手入力 2 種とは別の操作。
 * 口座種別での分岐をここ 1 か所に閉じ、画面や Query 実装に散らさない。
 */
export function acceptsBalanceManualEntry(account: Account): boolean {
  return account.kind === 'other_savings'
}
