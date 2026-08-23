/**
 * 月次レポート集約（家計分析コンテキスト）
 * @see docs/domain/08c-ul-家計分析.md §1
 * @see docs/domain/09-aggregates.md #8
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.2
 *
 * kawasima: data 月次レポート = CSV確定月次レポート OR 最終確定月次レポート
 * 不変条件: CSV確定 → 最終確定 の単方向遷移のみ許容（finalized → csv_confirmed への関数を提供しない）
 */
import { z } from 'zod'
import {
  MonthlyReportIdSchema,
  TransactionIdSchema,
  ExpenseReimbursementIdSchema,
  CategoryIdSchema,
  type ExpenseReimbursementId,
  type TransactionId,
  type UserId,
} from '../../shared/ids'
import { MoneySchema, type Money } from '../../shared/value-objects/Money'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'
import { type UserRole } from '../../shared/value-objects/UserRole'
import {
  UnapprovedExpenseTransferSchema,
  type UnapprovedExpenseTransfer,
} from '../../shared/value-objects/UnapprovedExpenseTransfer'
import { type Transaction } from './Transaction'

/**
 * 残高推移パート（残高・資産推移管理から借用する Read-only データ）
 *
 * #398 以降は **LINE 配信時点の値を残す凍結値**。資産の推移グラフが読む正は
 * 残高変動履歴（08d）に移り、ここは「配信したサマリに何と書いたか」の記録になった。
 * したがって後から書き換えない（配信済みの文面と食い違うため）。
 */
export const BalanceTrendSchema = z.object({
  smbcBalanceTrend: z.array(z.object({ date: z.date(), balance: MoneySchema })),
  otherSavingsBalanceTrend: z.array(z.object({ date: z.date(), balance: MoneySchema })),
  nisaContributionTrend: z.array(z.object({ date: z.date(), accumulated: MoneySchema })),
  cardUnpaidTrend: z.array(z.object({ date: z.date(), unpaidTotal: MoneySchema })),
})
export type BalanceTrend = z.infer<typeof BalanceTrendSchema>

/** 月次レポート共通属性 */
export const CommonMonthlyReportAttrsSchema = z.object({
  monthlyReportId: MonthlyReportIdSchema,
  targetYearMonth: YearMonthSchema,
  householdCategoryTotals: z.array(
    z.object({
      categoryId: CategoryIdSchema,
      total: MoneySchema,
    }),
  ),
  personalTotalHoney: MoneySchema,
  personalTotalDarling: MoneySchema,
  businessExpenseTotalHoney: MoneySchema,
  businessExpenseTotalDarling: MoneySchema,
  nisaContributionAccumulated: MoneySchema,
  balanceTrend: BalanceTrendSchema,
  isIncompleteMonth: z.boolean().optional(),
})
export type CommonMonthlyReportAttrs = z.infer<typeof CommonMonthlyReportAttrsSchema>

/** 月次レポート（discriminated union） */
export const MonthlyReportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('csv_confirmed'),
    common: CommonMonthlyReportAttrsSchema,
    csvConfirmedAt: z.date(),
    causingTransactionIds: z.array(TransactionIdSchema),
  }),
  z.object({
    kind: z.literal('finalized'),
    common: CommonMonthlyReportAttrsSchema,
    csvConfirmedAt: z.date(),
    finalizedAt: z.date(),
    expenseReimbursementId: ExpenseReimbursementIdSchema,
    expenseReimbursementMatchedAt: z.date(),
    unapprovedTransfers: z.array(UnapprovedExpenseTransferSchema),
  }),
])
export type MonthlyReport = z.infer<typeof MonthlyReportSchema>

export type CsvConfirmedReport = Extract<MonthlyReport, { kind: 'csv_confirmed' }>
export type FinalizedReport = Extract<MonthlyReport, { kind: 'finalized' }>

/** 月次レポート集計値（共通属性のうち、確定済み取引から算出する費用区分別合計） */
export const MonthlyReportTotalsSchema = CommonMonthlyReportAttrsSchema.pick({
  householdCategoryTotals: true,
  personalTotalHoney: true,
  personalTotalDarling: true,
  businessExpenseTotalHoney: true,
  businessExpenseTotalDarling: true,
})
export type MonthlyReportTotals = z.infer<typeof MonthlyReportTotalsSchema>

/**
 * 分類済み取引から月次レポート集計値を算出する。
 * - 未分類・削除済み取引は集計対象外
 * - 経費(会社) は世帯・個人の集計から除外し、所有者役割別の経費合計にのみ計上する（非対称ルール）
 */
export function aggregateMonthlyReportTotals(
  transactions: readonly Transaction[],
  roleOfOwner: (userId: UserId) => UserRole,
): MonthlyReportTotals {
  const householdByCategory = new Map<string, number>()
  let personalTotalHoney = 0
  let personalTotalDarling = 0
  let businessExpenseTotalHoney = 0
  let businessExpenseTotalDarling = 0

  for (const tx of transactions) {
    if (tx.kind !== 'classified') continue
    const amount = tx.common.amount
    switch (tx.details.expenseClass) {
      case 'household': {
        const categoryId = tx.details.categoryId
        householdByCategory.set(categoryId, (householdByCategory.get(categoryId) ?? 0) + amount)
        break
      }
      case 'personal_honey':
        personalTotalHoney += amount
        break
      case 'personal_darling':
        personalTotalDarling += amount
        break
      case 'business_expense':
        if (roleOfOwner(tx.common.ownerUserId) === 'honey') {
          businessExpenseTotalHoney += amount
        } else {
          businessExpenseTotalDarling += amount
        }
        break
    }
  }

  return MonthlyReportTotalsSchema.parse({
    householdCategoryTotals: [...householdByCategory]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([categoryId, total]) => ({
        categoryId,
        total,
      })),
    personalTotalHoney,
    personalTotalDarling,
    businessExpenseTotalHoney,
    businessExpenseTotalDarling,
  })
}

/** behavior 月次レポートをCSV確定状態に昇格する（08c §2） */
export function confirmCsv(
  common: CommonMonthlyReportAttrs,
  causingTransactionIds: TransactionId[],
  csvConfirmedAt: Date,
): CsvConfirmedReport {
  return MonthlyReportSchema.parse({
    kind: 'csv_confirmed',
    common,
    csvConfirmedAt,
    causingTransactionIds,
  }) as CsvConfirmedReport
}

/**
 * CSV確定済みレポートの再集計。レポートID・対象年月・CSV確定日時は変更不可（元レポートから
 * 引き継ぐ。再集計は新たな CSV 確定ではないため、08c §1 の CSV確定日時は動かさない）。
 * finalized レポートは型として受け付けない（CSV確定 → 最終確定 の単方向遷移を維持）。
 */
export function refreshCsvConfirmed(
  report: CsvConfirmedReport,
  totals: MonthlyReportTotals,
  causingTransactionIds: TransactionId[],
): CsvConfirmedReport {
  return MonthlyReportSchema.parse({
    kind: 'csv_confirmed',
    common: { ...report.common, ...totals },
    csvConfirmedAt: report.csvConfirmedAt,
    causingTransactionIds,
  }) as CsvConfirmedReport
}

/**
 * behavior 月次レポートに残高の凍結値を入れる（08c §2、#398）
 *
 * 残高変動履歴（08d）から取り出した当月の 4 軸の点と NISA 積立累計を、レポートへ写し取る。
 * LINE の月次サマリはこの凍結値を読むため、ここが空だと残高 3 行がサマリから消える。
 *
 * 再集計（refreshCsvConfirmed）は残高部分を触らないので、CSV 取込のたびに本関数で
 * 入れ直す。凍結の意味は「配信した時点の写し」であり、配信前の入れ直しは矛盾しない。
 */
export function freezeBalanceSnapshot(
  report: CsvConfirmedReport,
  snapshot: { balanceTrend: BalanceTrend; nisaContributionAccumulated: Money },
): CsvConfirmedReport {
  return MonthlyReportSchema.parse({
    ...report,
    common: {
      ...report.common,
      balanceTrend: snapshot.balanceTrend,
      nisaContributionAccumulated: snapshot.nisaContributionAccumulated,
    },
  }) as CsvConfirmedReport
}

/** 状態遷移: CSV確定 → 最終確定（単方向） */
export function finalize(
  report: CsvConfirmedReport,
  expenseReimbursementId: ExpenseReimbursementId,
  matchedAt: Date,
  unapprovedTransfers: UnapprovedExpenseTransfer[],
  finalizedAt: Date,
): FinalizedReport {
  return MonthlyReportSchema.parse({
    kind: 'finalized',
    common: report.common,
    csvConfirmedAt: report.csvConfirmedAt,
    finalizedAt,
    expenseReimbursementId,
    expenseReimbursementMatchedAt: matchedAt,
    unapprovedTransfers,
  }) as FinalizedReport
}

// finalized → csv_confirmed への逆遷移関数は型として存在しない（不変条件で禁止）

/**
 * 不完全月（対象月の全期間ぶんのデータが揃っていないレポート）か。
 *
 * 不完全月フラグは運用開始月のレポートにのみ付く（論点20）。付かない月では属性そのものが
 * 欠落するため、「未設定 = 揃っている」という読み方をここに一本化する
 * （レポート画面の注意書きも LINE サマリの注意書きも同じ判定を通す）。
 * 呼び出し側で真偽を判定すると、片方だけが未設定を不完全と読むずれが生まれる。
 */
export function isIncompleteMonthReport(
  common: Pick<CommonMonthlyReportAttrs, 'isIncompleteMonth'>,
): boolean {
  return common.isIncompleteMonth === true
}

/**
 * 閲覧者本人にだけ見える月次合計（プライバシー3段階ルールの最終段）。
 *
 * 個人費用は「相手には合計のみ可視」だが、経費(会社)は本人のみ可視のため、
 * 本人分の抜き出し方をここに一本化する（`MonthlyReportView` の
 * `businessExpenseTotalSelf` も LINE の個人サマリもこの関数を通す）。
 * 射影を呼び出し側で書き分けるとルール変更時に取りこぼしが出る。
 */
export const SelfMonthlyTotalsSchema = z.object({
  personalTotalSelf: MoneySchema,
  businessExpenseTotalSelf: MoneySchema,
})
export type SelfMonthlyTotals = z.infer<typeof SelfMonthlyTotalsSchema>

export function selfTotalsOf(
  common: CommonMonthlyReportAttrs,
  viewerRole: UserRole,
): SelfMonthlyTotals {
  return SelfMonthlyTotalsSchema.parse(
    viewerRole === 'honey'
      ? {
          personalTotalSelf: common.personalTotalHoney,
          businessExpenseTotalSelf: common.businessExpenseTotalHoney,
        }
      : {
          personalTotalSelf: common.personalTotalDarling,
          businessExpenseTotalSelf: common.businessExpenseTotalDarling,
        },
  )
}
