/**
 * ExpenseSettlementManagementQuery の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 「当月」は I/F が月を引数に取らないため、注入された now() から JST 暦月で導出する（§3）。
 * プライバシー（論点11: 本人のみ可視）はドメインの唯一の判定ポイント
 * canViewExpenseSettlement を返却前に必ず通す — 取得系が viewerId 起点のため
 * 構造上 true になるが、防御としてのガードを外さない
 * （第 1 波の privacy ヘルパと同じ高度）。
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import type {
  ExpenseSettlementManagementQuery,
  ExpenseSettlementManagementView,
  MonthlyExpenseCycle,
  UserId,
} from '@warimaru/domain'
import {
  canViewExpenseSettlement,
  ExpenseSettlementManagementViewSchema,
  MonthlyExpenseCycleSchema,
  PermissionDeniedError,
  ProratedChildTransactionSchema,
} from '@warimaru/domain'
import type { Db } from '../client'
import { monthlyExpenseCycles, proratedChildTransactions } from '../schema'
import { parsePayload } from '../serialize'
import { currentJstYearMonth } from '../jstCalendarDate'

export interface NeonExpenseSettlementManagementQueryDeps {
  /** 「当月」の基準時刻（テスト決定性のため注入） */
  now: () => Date
}

export class NeonExpenseSettlementManagementQuery implements ExpenseSettlementManagementQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: NeonExpenseSettlementManagementQueryDeps,
  ) {}

  async fetch(viewerId: UserId): Promise<ExpenseSettlementManagementView> {
    const currentMonth = currentJstYearMonth(this.deps.now())
    const [currentCycle, latestFinalized] = await Promise.all([
      this.findCycleByMonth(viewerId, currentMonth),
      this.findLatestFinalized(viewerId),
    ])
    const currentChildTransactions = await this.fetchChildTransactions(currentCycle)

    const view = ExpenseSettlementManagementViewSchema.parse({
      userId: viewerId,
      currentAccumulations: currentCycle?.common.accumulations ?? [],
      currentChildTransactions,
      latestFinalizedCycle:
        latestFinalized === null
          ? null
          : {
              monthlyExpenseCycleId: latestFinalized.common.monthlyExpenseCycleId,
              targetYearMonth: latestFinalized.common.targetYearMonth,
              finalizedAt: latestFinalized.finalizedAt,
              unapprovedTotal: latestFinalized.unapprovedTransfers.reduce(
                (total, transfer) => total + transfer.transferAmount,
                0,
              ),
            },
    })
    if (!canViewExpenseSettlement(view, viewerId)) {
      throw new PermissionDeniedError('経費精算管理ビューは本人のみ可視（論点11）')
    }
    return view
  }

  private async findCycleByMonth(
    userId: UserId,
    month: ReturnType<typeof currentJstYearMonth>,
  ): Promise<MonthlyExpenseCycle | null> {
    const rows = await this.db
      .select({ payload: monthlyExpenseCycles.payload })
      .from(monthlyExpenseCycles)
      .where(
        and(
          eq(monthlyExpenseCycles.userId, userId),
          eq(monthlyExpenseCycles.targetYearMonth, month),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MonthlyExpenseCycleSchema, row.payload)
  }

  private async findLatestFinalized(
    userId: UserId,
  ): Promise<Extract<MonthlyExpenseCycle, { kind: 'finalized' }> | null> {
    const rows = await this.db
      .select({ payload: monthlyExpenseCycles.payload })
      .from(monthlyExpenseCycles)
      .where(
        and(eq(monthlyExpenseCycles.userId, userId), eq(monthlyExpenseCycles.kind, 'finalized')),
      )
      .orderBy(desc(monthlyExpenseCycles.targetYearMonth))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    const cycle = parsePayload(MonthlyExpenseCycleSchema, row.payload)
    return cycle.kind === 'finalized' ? cycle : null
  }

  private async fetchChildTransactions(
    cycle: MonthlyExpenseCycle | null,
  ): Promise<ExpenseSettlementManagementView['currentChildTransactions']> {
    const refs = cycle?.common.childTransactionRefs ?? []
    if (refs.length === 0) return []
    const rows = await this.db
      .select({ payload: proratedChildTransactions.payload })
      .from(proratedChildTransactions)
      .where(
        inArray(
          proratedChildTransactions.childTransactionId,
          refs.map(ref => ref.childTransactionId),
        ),
      )
      .orderBy(proratedChildTransactions.childTransactionId)
    return rows.map(row => parsePayload(ProratedChildTransactionSchema, row.payload))
  }
}
