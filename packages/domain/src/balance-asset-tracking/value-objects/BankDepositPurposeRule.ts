/**
 * 銀行入金用途判別ルール（08d §1）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/03-open-questions.md OQ-21
 *
 * kawasima:
 *   data 銀行入金用途判別ルール = 勤務先入金判別ルール AND 別銀行戻し判別ルール
 *   data 勤務先入金判別ルール = 勤務先振込元名パターン AND 給与支給日窓 AND 給与判別閾値金額
 *   data 別銀行戻し判別ルール = 振込元名パターン
 *
 * OQ-21（2026-07-24 確定）: 給与と経費精算入金は同一の勤務先から同一の摘要で同一口座に
 * 入金されるため、振込元名・摘要では判別できない。入金日と金額の 2 シグナルで判定する。
 *
 * 閾値は世帯共通の口座ルールとして本コンテキストが持つ（07-bounded-contexts §1.1.4）。
 * per-user の学習ルール（08b）とは所有者軸が異なるため混ぜない。
 */
import { z } from 'zod'
import { MoneySchema, money, type Money } from '../../shared/value-objects/Money'
import { normalizeRemitterName } from './NormalizedRemitterName'

/**
 * 給与支給日窓の既定値（月内基準日 = 21 日、OQ-21 ①）。
 *
 * この日以降の入金を給与シグナル、以前を経費精算シグナルとする。給与支給日は月末だが
 * 土日祝で前倒しされ固定日にならないため、日ではなく窓で持つ。
 */
export const DEFAULT_SALARY_PAYOUT_DAY_WINDOW = 21

/** 給与判別閾値金額の既定値（25 万円、OQ-21 ②）。以上を給与シグナル、未満を経費精算シグナルとする */
export const DEFAULT_SALARY_THRESHOLD_AMOUNT = money(250_000)

export const BankDepositPurposeRuleSchema = z.object({
  /**
   * 勤務先振込元名パターン（正規化済み）。空配列だと勤務先入金を一件も認識できず
   * 給与・経費精算入金がすべて用途不明に落ちるため、1 件以上を必須とする。
   */
  employerRemitterNames: z.array(z.string().min(1)).min(1),
  /** 別銀行貯蓄口座の相手方名パターン（正規化済み）。未登録の世帯があるため空を許す */
  otherSavingsCounterpartyNames: z.array(z.string().min(1)).default([]),
  /** 月内基準日。月末日に依らず全月で成立する 1〜28 日に限る */
  salaryPayoutDayWindow: z.number().int().min(1).max(28).default(DEFAULT_SALARY_PAYOUT_DAY_WINDOW),
  /** 給与判別閾値金額。0 円以下だと全入金が給与シグナルになり金額シグナルが機能しない */
  salaryThresholdAmount: MoneySchema.refine(
    v => v > 0,
    '給与判別閾値金額は正である必要があります',
  ).default(DEFAULT_SALARY_THRESHOLD_AMOUNT),
})
export type BankDepositPurposeRule = z.infer<typeof BankDepositPurposeRuleSchema>

/**
 * ルールを組み立てる。名前パターンは登録時に正規化して保持する。
 * 照合時の正規化だけに頼ると、ルール側に未正規化の文字列が入った瞬間に
 * 恒久的に一致しなくなる（無言で全件が用途不明に落ちる）。
 */
export function bankDepositPurposeRule(params: {
  employerRemitterNames: string[]
  otherSavingsCounterpartyNames?: string[]
  salaryPayoutDayWindow?: number
  salaryThresholdAmount?: Money
}): BankDepositPurposeRule {
  return BankDepositPurposeRuleSchema.parse({
    employerRemitterNames: params.employerRemitterNames.map(normalizeRemitterName),
    otherSavingsCounterpartyNames: (params.otherSavingsCounterpartyNames ?? []).map(
      normalizeRemitterName,
    ),
    salaryPayoutDayWindow: params.salaryPayoutDayWindow,
    salaryThresholdAmount: params.salaryThresholdAmount,
  })
}
