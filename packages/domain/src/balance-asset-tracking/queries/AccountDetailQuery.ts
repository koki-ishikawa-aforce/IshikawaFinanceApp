import type { AccountId, UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { AccountDetailView } from './views/AccountDetailView'

export interface AccountDetailQuery {
  /**
   * 口座 1 件の詳細（#406。spec §9.3）。
   *
   * 口座ごとの値は本人のみ可視（P2-B5 / OQ-60 ①）。閲覧者が所有しない口座は null を返す。
   * 「他人の口座」と「存在しない口座」を同じ null にするのは、応答の違いから配偶者の
   * 口座の有無を数えられないようにするため（残高一覧が配偶者の口座件数を返さないのと同じ）。
   */
  fetch(
    viewerId: UserId,
    accountId: AccountId,
    from: YearMonth,
    to: YearMonth,
  ): Promise<AccountDetailView | null>
}
