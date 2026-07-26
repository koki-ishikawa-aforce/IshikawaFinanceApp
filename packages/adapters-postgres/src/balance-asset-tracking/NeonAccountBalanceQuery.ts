/**
 * AccountBalanceQuery の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.3
 *
 * 残高・資産推移管理は世帯共有のため viewerId を取らず、両者の全 active 口座を読む
 * （口座数は一桁で全走査に問題なし）。inactive 口座は残高一覧・資産合計に含めない。
 *
 * 別銀行貯蓄口座の残高鮮度（経過日数・鮮度状態）は本 Query では返さない。08d L244 の
 * とおり本コンテキストは最終更新日時のみを供給し、閾値判定は家計分析側
 * （`DashboardQuery.fetchBalanceFreshness`）が担う。
 *
 * fetchAssetTotal(asOf) の asOf は View にエコーされるスナップショット時刻。
 * データモデル上、過去時点の残高復元（historical as-of）はサポートしない
 * （残高履歴の正は月次レポートに凍結済み — BalanceTimeSeriesQuery が担う）。
 */
import { and, eq, sum } from 'drizzle-orm'
import type {
  Account,
  AccountBalanceItem,
  AccountBalanceListView,
  AccountBalanceQuery,
  AssetTotalView,
  MitsuiSumitomoUnpaid,
  Money,
} from '@warimaru/domain'
import {
  AccountBalanceListViewSchema,
  AccountSchema,
  AssetTotalViewSchema,
  MitsuiSumitomoUnpaidSchema,
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

export class NeonAccountBalanceQuery implements AccountBalanceQuery {
  constructor(private readonly db: Db) {}

  async fetchBalanceList(): Promise<AccountBalanceListView> {
    const rows = await this.db
      .select({ payload: accounts.payload, unpaidPayload: mitsuiSumitomoUnpaids.payload })
      .from(accounts)
      .leftJoin(mitsuiSumitomoUnpaids, eq(mitsuiSumitomoUnpaids.accountId, accounts.accountId))
      .where(eq(accounts.isActive, true))

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
    return AccountBalanceListViewSchema.parse({ items })
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
