/**
 * TransactionListQuery の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.1
 *
 * プライバシー 3 段階は SQL では表現しない。行を取得後、ドメインの唯一の
 * プライバシー判定ポイントである toListItems へ通して View を組み立てる。
 *
 * filter.expenseClass は SQL でなくメモリ上の item に適用する:
 * 未分類取引は DB では expense_class が NULL だが、View では
 * defaultExpenseClass を expenseClass として持つため、SQL で絞ると
 * 未分類行が不当に落ちる（データ量は世帯 2 名 × 1 ヶ月分で問題なし）。
 */
import { and, desc, eq, gte, lt, ne } from 'drizzle-orm'
import type {
  Transaction,
  TransactionId,
  TransactionListFilter,
  TransactionListItem,
  TransactionListQuery,
  UnclassifiedSummary,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import { TransactionSchema, toListItems } from '@warimaru/domain'
import type { Db } from '../client'
import { transactions } from '../schema'
import { parsePayload } from '../serialize'
import { yearMonthToUtcRange } from '../yearMonthToUtcRange'
import type { ResolveCategoryNames, ResolveViewerRole } from '../queryDeps'

/** fetchUnclassifiedSummary の recentIds 件数（ダッシュボード導線の直近表示用） */
const UNCLASSIFIED_RECENT_IDS_LIMIT = 5

export interface NeonTransactionListQueryDeps {
  resolveCategoryNames: ResolveCategoryNames
  resolveViewerRole: ResolveViewerRole
}

export class NeonTransactionListQuery implements TransactionListQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: NeonTransactionListQueryDeps,
  ) {}

  async fetch(viewerId: UserId, filter: TransactionListFilter): Promise<TransactionListItem[]> {
    const { fromUtc, toUtc } = yearMonthToUtcRange(filter.month)
    const conditions = [
      gte(transactions.occurredAt, fromUtc),
      lt(transactions.occurredAt, toUtc),
      // deleted はリストから常に除外（toListItems でも除外されるが行数を減らす）
      ne(transactions.kind, 'deleted'),
    ]
    if (filter.isUnclassifiedOnly === true) {
      conditions.push(eq(transactions.kind, 'unclassified'))
    }
    // owner フィルタなし: 配偶者の世帯取引もリストに載る（可視性は toListItems が決める）
    const rows = await this.db
      .select({ payload: transactions.payload })
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.occurredAt), desc(transactions.transactionId))

    const txs: Transaction[] = rows.map(row => parsePayload(TransactionSchema, row.payload))

    const role = await this.deps.resolveViewerRole(viewerId)
    const categoryIds = [
      ...new Set(txs.flatMap(tx => (tx.kind === 'classified' ? [tx.details.categoryId] : []))),
    ]
    const categoryNames = await this.deps.resolveCategoryNames(categoryIds)

    const items = toListItems(txs, { viewerId, role }, categoryNames)
    if (filter.expenseClass === undefined) return items
    return items.filter(item => item.expenseClass === filter.expenseClass)
  }

  async fetchUnclassifiedSummary(viewerId: UserId, month: YearMonth): Promise<UnclassifiedSummary> {
    const { fromUtc, toUtc } = yearMonthToUtcRange(month)
    // 未分類は所有者本人のみ可視（プライバシールール 4）— partial index が効く形
    const rows = await this.db
      .select({ transactionId: transactions.transactionId })
      .from(transactions)
      .where(
        and(
          eq(transactions.ownerUserId, viewerId),
          eq(transactions.kind, 'unclassified'),
          gte(transactions.occurredAt, fromUtc),
          lt(transactions.occurredAt, toUtc),
        ),
      )
      .orderBy(desc(transactions.occurredAt), desc(transactions.transactionId))

    return {
      count: rows.length,
      recentIds: rows
        .slice(0, UNCLASSIFIED_RECENT_IDS_LIMIT)
        .map(row => row.transactionId) as TransactionId[],
    }
  }
}
