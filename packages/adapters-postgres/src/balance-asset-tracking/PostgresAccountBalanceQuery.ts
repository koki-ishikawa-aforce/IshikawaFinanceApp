/**
 * AccountBalanceQuery の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.3
 *
 * 残高一覧（fetchBalanceList）は本人のみ可視（P2-B5 / AT-404 / OQ-60 ①）。閲覧者所有の
 * active 口座だけを並べ、配偶者の口座は 1 件も返さない。配偶者については別銀行貯蓄残高と
 * NISA 積立累計の合計だけを返す（配偶者の SMBC 残高・カード未払金・銀行名・口座件数は
 * 一切返さない）。配偶者は許可リスト（`AllowlistQuery`）で解決した登録済みの相手のみで、
 * 「閲覧者以外の持ち主」では絞らない（#595）。
 *
 * 資産合計（fetchAssetTotal）は世帯フルオープンなので閲覧者では絞らず、両者の全 active
 * 口座を読む（OQ-60 ②。口座数は一桁で全走査に問題なし）。閲覧者は「絞らないこと」を
 * 明示するために受け取るのみで、フィルタ条件には使わない（プライバシー3段階ルール）。
 * inactive 口座は残高一覧・資産合計いずれにも含めない。
 *
 * 別銀行貯蓄口座の残高鮮度（経過日数・鮮度状態）は本 Query では返さない。08d L244 の
 * とおり本コンテキストは最終更新日時のみを供給し、閾値判定は家計分析側
 * （`DashboardQuery.fetchBalanceFreshness`）が担う。
 *
 * fetchAssetTotal(viewerId, asOf) の asOf は View にエコーされるスナップショット時刻。
 * データモデル上、過去時点の残高復元（historical as-of）はサポートしない
 * （過去の推移は残高変動履歴を読む BalanceTimeSeriesQuery が担う — #398）。
 */
import { and, eq, inArray, sum } from 'drizzle-orm'
import type {
  Account,
  AccountBalanceItem,
  AccountBalanceListView,
  AccountBalanceQuery,
  Allowlist,
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
  MITSUI_SUMITOMO_CARD_DISPLAY_NAME,
  SMBC_BANK_DISPLAY_NAME,
  SPOUSE_TOTAL_VISIBLE_ACCOUNT_KINDS,
  accountDisplayName,
  canListAccountInBalanceList,
  resolveSpouseUserId,
  spouseVisibleAssetTotal,
} from '@warimaru/domain'
import type { Db } from '../client'
import { accounts, mitsuiSumitomoUnpaids } from '../schema'
import { parsePayload } from '../serialize'

export interface PostgresAccountBalanceQueryDeps {
  /** 配偶者の口座を「自分以外」ではなく登録済みの相手で限定するための許可リスト参照(#595) */
  fetchAllowlist: () => Promise<Allowlist>
}

const KIND_ORDER: Record<Account['kind'], number> = {
  smbc_bank: 0,
  mitsui_sumitomo_card: 1,
  other_savings: 2,
  nisa: 3,
}

export class PostgresAccountBalanceQuery implements AccountBalanceQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: PostgresAccountBalanceQueryDeps,
  ) {}

  async fetchBalanceList(viewerId: UserId): Promise<AccountBalanceListView> {
    // 配偶者は許可リストから解決した登録済みの相手のみとする（「自分以外」ではない。
    // 2人以外の持ち主の記録が万一残っても、その分は合計に混ざらない。#595）
    const spouseUserId = resolveSpouseUserId(viewerId, await this.deps.fetchAllowlist())

    // 本番は 1 文 = 1 往復（neon-http）のため、本人の口座と配偶者の口座は並行に読む
    const [rows, spouseAccounts] = await Promise.all([
      this.db
        .select({ payload: accounts.payload, unpaidPayload: mitsuiSumitomoUnpaids.payload })
        .from(accounts)
        .leftJoin(mitsuiSumitomoUnpaids, eq(mitsuiSumitomoUnpaids.accountId, accounts.accountId))
        .where(and(eq(accounts.ownerUserId, viewerId), eq(accounts.isActive, true))),
      this.fetchSpouseVisibleAccounts(spouseUserId),
    ])

    const parsed = rows
      .map(row => ({
        account: parsePayload(AccountSchema, row.payload),
        unpaid:
          row.unpaidPayload === null
            ? null
            : parsePayload(MitsuiSumitomoUnpaidSchema, row.unpaidPayload),
      }))
      // 絞り込みは SQL 側で済んでいるが、可視判定の正はドメインに置く
      .filter(({ account }) => canListAccountInBalanceList(account, viewerId))

    parsed.sort((a, b) => {
      const byKind = KIND_ORDER[a.account.kind] - KIND_ORDER[b.account.kind]
      if (byKind !== 0) return byKind
      return a.account.common.registeredAt.getTime() - b.account.common.registeredAt.getTime()
    })

    const items = parsed.map(({ account, unpaid }) => this.toItem(account, unpaid))
    return AccountBalanceListViewSchema.parse({
      items,
      // 合計の求め方と「対象口座が無ければ null」の規約はドメイン側が持つ
      spouseOtherSavingsAndNisaTotal: spouseVisibleAssetTotal(spouseAccounts, spouseUserId),
    })
  }

  /**
   * 配偶者のうち、閲覧者に合計だけを見せてよい口座（P2-B5 の「合計のみ配偶者可視」）。
   * 対象の口座種別はドメインの定義を参照し、絞り込みだけを SQL で行う。
   */
  private async fetchSpouseVisibleAccounts(spouseUserId: UserId): Promise<Account[]> {
    const rows = await this.db
      .select({ payload: accounts.payload })
      .from(accounts)
      .where(
        and(
          eq(accounts.ownerUserId, spouseUserId),
          eq(accounts.isActive, true),
          inArray(accounts.kind, [...SPOUSE_TOTAL_VISIBLE_ACCOUNT_KINDS]),
        ),
      )
    return rows.map(row => parsePayload(AccountSchema, row.payload))
  }

  async fetchAssetTotal(_viewerId: UserId, asOf: Date): Promise<AssetTotalView> {
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
          // 固定名はドメインの定数を使う（View スキーマがリテラル型で受けるため関数の戻り値では通らない）
          displayName: SMBC_BANK_DISPLAY_NAME,
          currentBalance: account.balance.currentBalance,
          lastUpdatedAt: account.balance.lastUpdatedAt,
        }
      case 'mitsui_sumitomo_card':
        // 集約参照上 unpaid は必ず存在するはずだが、欠損時は 0 / null にフォールバック（防御）
        return {
          kind: 'mitsui_sumitomo_card',
          accountId: account.common.accountId,
          displayName: MITSUI_SUMITOMO_CARD_DISPLAY_NAME,
          currentMonthUnpaidTotal: unpaid === null ? (0 as Money) : unpaid.currentMonthUnpaidTotal,
          lastSettledAt: unpaid === null ? null : unpaid.lastSettledAt,
        }
      case 'other_savings':
        return {
          kind: 'other_savings',
          accountId: account.common.accountId,
          displayName: accountDisplayName(account),
          currentBalance: account.balance.currentBalance,
          lastUpdatedAt: account.balance.lastUpdatedAt,
        }
      case 'nisa':
        return {
          kind: 'nisa',
          accountId: account.common.accountId,
          displayName: accountDisplayName(account),
          currentAccumulated: account.contribution.currentAccumulated,
          lastUpdatedAt: account.contribution.lastUpdatedAt,
        }
    }
  }
}
