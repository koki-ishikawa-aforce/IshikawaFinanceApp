/**
 * AccountBalanceQuery の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.3
 *
 * 残高一覧（fetchBalanceList）は本人のみ可視（P2-B5 / AT-404 / OQ-60 ①）。閲覧者所有の
 * active 口座だけを並べ、配偶者の口座は 1 件も返さない。配偶者については別銀行貯蓄残高と
 * NISA 積立累計の合計だけを返す（配偶者の SMBC 残高・カード未払金・銀行名・口座件数は
 * 一切返さない）。
 *
 * 資産合計（fetchAssetTotal）は世帯の合計と 4 つの内訳を出し続けるため閲覧者で絞らず、
 * 両者の全 active 口座を読む（OQ-60 ②。口座数は一桁で全走査に問題なし）。
 * inactive 口座は残高一覧・資産合計いずれにも含めない。
 *
 * 別銀行貯蓄口座の残高鮮度（経過日数・鮮度状態）は本 Query では返さない。08d L244 の
 * とおり本コンテキストは最終更新日時のみを供給し、閾値判定は家計分析側
 * （`DashboardQuery.fetchBalanceFreshness`）が担う。
 *
 * fetchAssetTotal(asOf) の asOf は View にエコーされるスナップショット時刻。
 * データモデル上、過去時点の残高復元（historical as-of）はサポートしない
 * （過去の推移は残高変動履歴を読む BalanceTimeSeriesQuery が担う — #398）。
 */
import { and, eq, inArray, ne, sum } from 'drizzle-orm'
import type {
  Account,
  AccountBalanceItem,
  AccountBalanceListView,
  AccountBalanceQuery,
  AssetTotalView,
  MitsuiSumitomoUnpaid,
  Money,
  UserId,
} from '@warimaru/domain'
import {
  AccountBalanceListViewSchema,
  AccountSchema,
  AssetTotalViewSchema,
  MitsuiSumitomoUnpaidSchema,
  MoneySchema,
  brokerageNameToDisplay,
} from '@warimaru/domain'
import type { Db } from '../client'
import { accounts, mitsuiSumitomoUnpaids } from '../schema'
import { parsePayload } from '../serialize'

const KIND_ORDER: Record<Account['kind'], number> = {
  smbc_bank: 0,
  mitsui_sumitomo_card: 1,
  other_savings: 2,
  nisa: 3,
}

export class PostgresAccountBalanceQuery implements AccountBalanceQuery {
  constructor(private readonly db: Db) {}

  async fetchBalanceList(viewerId: UserId): Promise<AccountBalanceListView> {
    const rows = await this.db
      .select({ payload: accounts.payload, unpaidPayload: mitsuiSumitomoUnpaids.payload })
      .from(accounts)
      .leftJoin(mitsuiSumitomoUnpaids, eq(mitsuiSumitomoUnpaids.accountId, accounts.accountId))
      .where(and(eq(accounts.ownerUserId, viewerId), eq(accounts.isActive, true)))

    const parsed = rows.map(row => ({
      account: parsePayload(AccountSchema, row.payload),
      unpaid:
        row.unpaidPayload === null
          ? null
          : parsePayload(MitsuiSumitomoUnpaidSchema, row.unpaidPayload),
    }))

    parsed.sort((a, b) => {
      const byKind = KIND_ORDER[a.account.kind] - KIND_ORDER[b.account.kind]
      if (byKind !== 0) return byKind
      return a.account.common.registeredAt.getTime() - b.account.common.registeredAt.getTime()
    })

    const items = parsed.map(({ account, unpaid }) => this.toItem(account, unpaid))
    return AccountBalanceListViewSchema.parse({
      items,
      spouseOtherSavingsAndNisaTotal: await this.sumSpouseOtherSavingsAndNisa(viewerId),
    })
  }

  /**
   * 配偶者の別銀行貯蓄残高 + NISA 積立累計の合計（P2-B5 の「合計のみ配偶者可視」）。
   * 対象の active 口座が 1 件も無ければ null を返し、「0 円」と「口座が無い」を
   * 呼び出し側が区別できるようにする（0 円で返すと未登録の配偶者にも合計行が出る）。
   */
  private async sumSpouseOtherSavingsAndNisa(viewerId: UserId): Promise<Money | null> {
    const rows = await this.db
      .select({ payload: accounts.payload })
      .from(accounts)
      .where(
        and(
          ne(accounts.ownerUserId, viewerId),
          eq(accounts.isActive, true),
          inArray(accounts.kind, ['other_savings', 'nisa']),
        ),
      )
    if (rows.length === 0) return null

    let total = 0
    for (const row of rows) {
      const account = parsePayload(AccountSchema, row.payload)
      if (account.kind === 'other_savings') total += account.balance.currentBalance
      if (account.kind === 'nisa') total += account.contribution.currentAccumulated
    }
    return MoneySchema.parse(total)
  }

  async fetchAssetTotal(asOf: Date): Promise<AssetTotalView> {
    const rows = await this.db
      .select({ payload: accounts.payload })
      .from(accounts)
      .where(eq(accounts.isActive, true))

    let smbcBalance = 0
    let otherSavingsBalance = 0
    let nisaContributionAccumulated = 0
    for (const row of rows) {
      const account = parsePayload(AccountSchema, row.payload)
      if (account.kind === 'smbc_bank') smbcBalance += account.balance.currentBalance
      if (account.kind === 'other_savings') otherSavingsBalance += account.balance.currentBalance
      if (account.kind === 'nisa') {
        nisaContributionAccumulated += account.contribution.currentAccumulated
      }
    }

    // カード未払金は昇格カラムの SUM で完結（payload 不読）
    const unpaidRows = await this.db
      .select({ total: sum(mitsuiSumitomoUnpaids.currentMonthUnpaidTotal).mapWith(Number) })
      .from(mitsuiSumitomoUnpaids)
      .innerJoin(accounts, eq(accounts.accountId, mitsuiSumitomoUnpaids.accountId))
      .where(and(eq(accounts.isActive, true)))
    const cardUnpaidTotal = unpaidRows[0]?.total ?? 0

    return AssetTotalViewSchema.parse({
      asOf,
      smbcBalance,
      otherSavingsBalance,
      nisaContributionAccumulated,
      cardUnpaidTotal,
      total: smbcBalance + otherSavingsBalance + nisaContributionAccumulated - cardUnpaidTotal,
    })
  }

  private toItem(account: Account, unpaid: MitsuiSumitomoUnpaid | null): AccountBalanceItem {
    switch (account.kind) {
      case 'smbc_bank':
        return {
          kind: 'smbc_bank',
          accountId: account.common.accountId,
          displayName: '三井住友銀行',
          currentBalance: account.balance.currentBalance,
          lastUpdatedAt: account.balance.lastUpdatedAt,
        }
      case 'mitsui_sumitomo_card':
        // 集約参照上 unpaid は必ず存在するはずだが、欠損時は 0 / null にフォールバック（防御）
        return {
          kind: 'mitsui_sumitomo_card',
          accountId: account.common.accountId,
          displayName: '三井住友カード',
          currentMonthUnpaidTotal: unpaid === null ? (0 as Money) : unpaid.currentMonthUnpaidTotal,
          lastSettledAt: unpaid === null ? null : unpaid.lastSettledAt,
        }
      case 'other_savings':
        return {
          kind: 'other_savings',
          accountId: account.common.accountId,
          displayName: account.bankName,
          currentBalance: account.balance.currentBalance,
          lastUpdatedAt: account.balance.lastUpdatedAt,
        }
      case 'nisa':
        return {
          kind: 'nisa',
          accountId: account.common.accountId,
          displayName: brokerageNameToDisplay(account.brokerageName),
          currentAccumulated: account.contribution.currentAccumulated,
          lastUpdatedAt: account.contribution.lastUpdatedAt,
        }
    }
  }
}
