/**
 * DashboardQuery の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.1
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.4
 *
 * 当月支出（currentMonthSpending）:
 *  - 世帯モード: expense_class = 'household' の全体合計（世帯支出は両者に合計可視のため
 *    owner フィルタなし）
 *  - 個人モード: viewer の役割に対応する personal_honey / personal_darling の合計
 *    （個人費用区分自体が本人を特定するため owner フィルタ不要。配偶者にも合計は可視）
 *  - business_expense は両モードで除外（会社経費は家計支出でなく、プライバシー
 *    ルール 3 で他者の集計にも含めない）
 *
 * 貯蓄残高 / NISA / 資産合計は残高・資産推移管理からの借用（viewer 所有の
 * active 口座のみ）。totalAssets = 貯蓄 + NISA − カード未払金
 * （ドメインの DashboardKpisView docstring / AssetTotalView の式を正とする）。
 *
 * KPI・カテゴリ内訳とも昇格カラムの集計だけで完結し、transactions の payload は
 * 読まない（spec §4.1）。口座残高のみ accounts / mitsui_sumitomo_unpaids の
 * payload を読む（Read 側のコンテキスト横断は許容）。
 */
import { and, count, eq, gte, inArray, lt, sum } from 'drizzle-orm'
import type {
  CategoryBreakdownView,
  CategoryId,
  DashboardKpisView,
  DashboardMode,
  DashboardQuery,
  ExpenseClass,
  UserId,
  UserRole,
  YearMonth,
} from '@warimaru/domain'
import {
  AccountSchema,
  CategoryBreakdownViewSchema,
  DashboardKpisViewSchema,
} from '@warimaru/domain'
import type { Db } from '../client'
import { accounts, mitsuiSumitomoUnpaids, transactions } from '../schema'
import { parsePayload } from '../serialize'
import { yearMonthToUtcRange } from '../yearMonthToUtcRange'
import type { ResolveCategoryNames, ResolveViewerRole } from '../queryDeps'

function spendingClass(mode: DashboardMode, role: UserRole): ExpenseClass {
  return mode === 'household'
    ? 'household'
    : role === 'honey'
      ? 'personal_honey'
      : 'personal_darling'
}

export interface NeonDashboardQueryDeps {
  resolveCategoryNames: ResolveCategoryNames
  resolveViewerRole: ResolveViewerRole
}

export class NeonDashboardQuery implements DashboardQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: NeonDashboardQueryDeps,
  ) {}

  async fetchKpis(
    viewerId: UserId,
    month: YearMonth,
    mode: DashboardMode,
  ): Promise<DashboardKpisView> {
    const role = await this.deps.resolveViewerRole(viewerId)
    const { fromUtc, toUtc } = yearMonthToUtcRange(month)

    const spendingRows = await this.db
      .select({ total: sum(transactions.amount).mapWith(Number) })
      .from(transactions)
      .where(
        and(
          eq(transactions.kind, 'classified'),
          eq(transactions.expenseClass, spendingClass(mode, role)),
          gte(transactions.occurredAt, fromUtc),
          lt(transactions.occurredAt, toUtc),
        ),
      )
    const currentMonthSpending = spendingRows[0]?.total ?? 0

    const { savingsBalance, nisaContributionAccumulated } = await this.sumViewerBalances(viewerId)
    const cardUnpaidTotal = await this.sumViewerCardUnpaid(viewerId)

    return DashboardKpisViewSchema.parse({
      mode,
      currentMonthSpending,
      savingsBalance,
      nisaContributionAccumulated,
      totalAssets: savingsBalance + nisaContributionAccumulated - cardUnpaidTotal,
    })
  }

  async fetchCategoryBreakdown(
    viewerId: UserId,
    month: YearMonth,
    mode: DashboardMode,
  ): Promise<CategoryBreakdownView> {
    const role = await this.deps.resolveViewerRole(viewerId)
    const { fromUtc, toUtc } = yearMonthToUtcRange(month)

    const rows = await this.db
      .select({
        categoryId: transactions.categoryId,
        total: sum(transactions.amount).mapWith(Number),
        count: count(),
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.kind, 'classified'),
          eq(transactions.expenseClass, spendingClass(mode, role)),
          gte(transactions.occurredAt, fromUtc),
          lt(transactions.occurredAt, toUtc),
        ),
      )
      .groupBy(transactions.categoryId)

    const categoryIds = rows
      .map(r => r.categoryId)
      .filter((id): id is string => id !== null) as CategoryId[]
    const names = await this.deps.resolveCategoryNames(categoryIds)

    const totalAmount = rows.reduce((acc, r) => acc + r.total, 0)
    const items = rows
      .filter((r): r is typeof r & { categoryId: string } => r.categoryId !== null)
      .map(r => ({
        categoryId: r.categoryId,
        // 未解決 ID は raw ID をフォールバック表示名にする（Read 側の堅牢性優先）
        categoryName: names.get(r.categoryId) ?? r.categoryId,
        total: r.total,
        count: r.count,
        // 返金等の負値で 0–100 を外れうるためクランプ（View schema の range 制約に合わせる）
        percentage:
          totalAmount === 0 ? 0 : Math.min(100, Math.max(0, (r.total / totalAmount) * 100)),
      }))
      .sort((a, b) => b.total - a.total)

    return CategoryBreakdownViewSchema.parse({
      mode,
      yearMonth: month,
      totalAmount,
      items,
    })
  }

  /** viewer 所有の active 口座から貯蓄残高（SMBC + 別銀行）と NISA 積立原資を合算 */
  private async sumViewerBalances(
    viewerId: UserId,
  ): Promise<{ savingsBalance: number; nisaContributionAccumulated: number }> {
    const rows = await this.db
      .select({ payload: accounts.payload })
      .from(accounts)
      .where(
        and(
          eq(accounts.ownerUserId, viewerId),
          eq(accounts.isActive, true),
          inArray(accounts.kind, ['smbc_bank', 'other_savings', 'nisa']),
        ),
      )
    let savingsBalance = 0
    let nisaContributionAccumulated = 0
    for (const row of rows) {
      const account = parsePayload(AccountSchema, row.payload)
      if (account.kind === 'smbc_bank' || account.kind === 'other_savings') {
        savingsBalance += account.balance.currentBalance
      } else if (account.kind === 'nisa') {
        nisaContributionAccumulated += account.contribution.currentAccumulated
      }
    }
    return { savingsBalance, nisaContributionAccumulated }
  }

  /** viewer 所有の active カード口座の当月未払金合計（昇格カラムのみ、payload 不読） */
  private async sumViewerCardUnpaid(viewerId: UserId): Promise<number> {
    const rows = await this.db
      .select({ total: sum(mitsuiSumitomoUnpaids.currentMonthUnpaidTotal).mapWith(Number) })
      .from(mitsuiSumitomoUnpaids)
      .innerJoin(accounts, eq(accounts.accountId, mitsuiSumitomoUnpaids.accountId))
      .where(and(eq(accounts.ownerUserId, viewerId), eq(accounts.isActive, true)))
    return rows[0]?.total ?? 0
  }
}
