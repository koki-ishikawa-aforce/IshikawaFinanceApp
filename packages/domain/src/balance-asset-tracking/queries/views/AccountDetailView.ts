/**
 * 口座詳細（#406。spec §9.3「個別詳細」）
 *
 * 残高一覧（`AccountBalanceListView`）が世帯の 4 口座を横並びで見せるのに対し、
 * こちらは 1 口座の中身（いまの値・その口座だけの推移・その口座の履歴）を見せる。
 *
 * 口座ごとの値は本人のみ可視（P2-B5 / OQ-60 ①。残高一覧が配偶者の口座を 1 件も
 * 返さないのと同じ規律）。閲覧者が所有しない口座は Query が null を返し、この View は
 * 作られない。
 */
import { z } from 'zod'
import { AccountIdSchema } from '../../../shared/ids'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { AccountBalanceHistoryRowSchema } from '../../aggregates/BalanceHistoryEntry'
import { AccountKindSchema } from '../../value-objects/AccountKind'
import { BalancePointSchema } from './BalanceTimeSeriesView'

export const AccountDetailViewSchema = z.object({
  accountId: AccountIdSchema,
  kind: AccountKindSchema,
  /** 銀行名・証券会社名（三井住友系は固定名）。残高一覧の displayName と同じ規則 */
  displayName: z.string(),
  isActive: z.boolean(),
  /**
   * いまの値。口座種別ごとに意味が変わる（残高 / 積立累計 / 当月未払い合計）。
   * どの言葉で見せるかは `kind` から画面が決める。
   */
  currentValue: MoneySchema,
  /**
   * 最終更新日時。カード口座は「前回の精算日」で、精算が一度も無ければ null。
   * 0 埋めや登録日での代用はしない（「まだ無い」と「その日だった」を混ぜないため）。
   */
  lastUpdatedAt: z.date().nullable(),
  /**
   * 残高の手入力（取り崩し・残高補正）を受け付ける口座か（`acceptsBalanceManualEntry`）。
   * 画面が種別を条件分岐して書くと、口座種別が増えたときにボタンの出し分けだけ取り残される。
   */
  supportsBalanceManualEntry: z.boolean(),
  /** グラフの期間（この View を求めたときの from / to。'YYYY-MM'） */
  yearMonthRange: z.object({ from: z.string(), to: z.string() }),
  /** 単線グラフの点。期間より前の最後の値を起点として含む（動きが無い期間でも線が出る） */
  series: z.array(BalancePointSchema),
  /** 残高の変動履歴（自動反映 + 手入力）。新しい順 */
  history: z.array(AccountBalanceHistoryRowSchema),
})
export type AccountDetailView = z.infer<typeof AccountDetailViewSchema>
