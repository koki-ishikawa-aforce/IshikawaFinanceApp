/**
 * 残高一覧の可視範囲（P2-B5 / AT-404 / OQ-60 ①）
 *
 * 口座ごとの残高は本人のみが見られる。配偶者については、別銀行貯蓄残高と NISA 積立累計の
 * 合計だけを見せ、口座の件数も銀行名も SMBC 残高もカード未払金も見せない。
 *
 * 一覧は Query 実装が本人分だけを引く前提だが、判定をドメイン側にも置いて呼び出し側の
 * 絞り込み漏れが露出にならないようにする（`canViewBankDeposit` と同じ考え方）。
 */
import type { UserId } from '../../shared/ids'
import { type Money, MoneySchema } from '../../shared/value-objects/Money'
import type { Account } from '../aggregates/Account'

/** 配偶者には合計だけを見せる口座種別。SMBC 銀行・三井住友カードは合計にも含めない */
export const SPOUSE_TOTAL_VISIBLE_ACCOUNT_KINDS = ['other_savings', 'nisa'] as const

/** 残高一覧に口座 1 件として並べてよいか（本人の active 口座のみ） */
export function canListAccountInBalanceList(account: Account, viewerId: UserId): boolean {
  return account.common.ownerUserId === viewerId && account.common.activeness.kind === 'active'
}

/**
 * 口座詳細（#406）を見てよいか。所有者本人のみ。
 *
 * 一覧（`canListAccountInBalanceList`）と違い、非アクティブの口座も見てよい。
 * 閉じた口座こそ「いつ閉じたのか・それまでどう動いたのか」を確かめる先が要る
 * （再アクティブ化〔#457〕の判断材料でもある）。一覧に並べないのは「いまの資産」の
 * 話で、履歴を見せない理由にはならない。
 */
export function canViewAccountDetail(account: Account, viewerId: UserId): boolean {
  return account.common.ownerUserId === viewerId
}

/**
 * 配偶者について閲覧者に見せてよい資産の合計。
 *
 * 対象は配偶者の active な別銀行貯蓄・NISA 口座。対象が 1 件も無ければ null を返し、
 * 「合計 0 円」（取り崩して残高が 0 になった状態）と「その口座を持っていない」を
 * 呼び出し側が区別できるようにする。0 円で返すと、口座を持たない配偶者にも
 * 合計 0 円の行が出てしまう。
 *
 * 対象は「閲覧者以外」ではなく、許可リストで登録済みの配偶者ユーザーIDに一致する口座に
 * 限定する。夫婦 2 人以外の持ち主の記録が万一残っても、合計に混ざらないようにするため
 * （#595）。呼び出し側は `resolveSpouseUserId` で解決した ID を渡す。
 */
export function spouseVisibleAssetTotal(
  accounts: readonly Account[],
  spouseUserId: UserId,
): Money | null {
  const visible = accounts.filter(
    account =>
      account.common.ownerUserId === spouseUserId &&
      account.common.activeness.kind === 'active' &&
      (SPOUSE_TOTAL_VISIBLE_ACCOUNT_KINDS as readonly string[]).includes(account.kind),
  )
  if (visible.length === 0) return null

  const total = visible.reduce((sum, account) => {
    if (account.kind === 'other_savings') return sum + account.balance.currentBalance
    if (account.kind === 'nisa') return sum + account.contribution.currentAccumulated
    return sum
  }, 0)
  return MoneySchema.parse(total)
}
