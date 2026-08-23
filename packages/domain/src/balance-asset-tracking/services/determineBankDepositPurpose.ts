/**
 * 銀行入金・出金の用途判別（残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §2「銀行入金の用途を判別する」
 * @see docs/domain/03-open-questions.md OQ-21
 * @see docs/domain/07-bounded-contexts.md §1.1.4
 *
 * kawasima:
 *   behavior 銀行入金の用途を判別する
 *     = 入金変動 AND 銀行入金用途判別ルール -> 入金用途判別結果 AND 入金用途判別イベント
 *
 * 判別は入力だけで決まる純粋関数。I/O も永続化もここには置かない
 * （§1.1.4: 用途判別は残高・資産推移管理に閉じ込める）。
 */
import { jstCalendarParts } from '../../shared/value-objects/JstCalendar'
import type { Money } from '../../shared/value-objects/Money'
import {
  BankDepositPurposeRuleSchema,
  bankDepositPurposeRuleOptions,
  type BankDepositPurposeRule,
  type BankDepositPurposeRuleOptionsInput,
} from '../value-objects/BankDepositPurposeRule'
import {
  employerRemitterNamesOf,
  type EmployerRemitterDirectory,
} from '../aggregates/EmployerRemitterDirectory'
import { normalizeRemitterName } from '../value-objects/NormalizedRemitterName'
import { DepositPurposeSchema, type DepositPurpose } from '../value-objects/DepositPurpose'
import {
  WithdrawalPurposeSchema,
  type OtherSavingsCounterpartyNames,
  type WithdrawalPurpose,
} from '../value-objects/WithdrawalPurpose'

/** 2 シグナルのいずれかが指す用途。一致したときだけ自動確定する（OQ-21 ③） */
type PurposeSignal = 'salary' | 'expense_reimbursement'

/**
 * 入金日シグナル（OQ-21 ①）。月内基準日以降なら給与寄り、以前なら経費精算寄り。
 *
 * 判定は JST の暦日で行う。給与支給日・経費精算入金日は利用者から見た日付であり、
 * UTC のまま日を読むと JST 深夜帯の入金が前日扱いになって境界がずれる。
 */
function depositDaySignal(occurredAt: Date, payoutDayWindow: number): PurposeSignal {
  const { day } = jstCalendarParts(occurredAt)
  return day >= payoutDayWindow ? 'salary' : 'expense_reimbursement'
}

/** 金額シグナル（OQ-21 ②）。閾値以上なら給与寄り、未満なら経費精算寄り */
function depositAmountSignal(amount: Money, thresholdAmount: Money): PurposeSignal {
  return amount >= thresholdAmount ? 'salary' : 'expense_reimbursement'
}

/** 用途不明（暫定処理 = 手動確認待ち）。判別の落とし先が 3 か所あるため 1 か所で組み立てる */
function awaitingManualConfirmation(): DepositPurpose {
  return DepositPurposeSchema.parse({
    kind: 'unknown',
    provisionalHandling: 'awaiting_manual_confirmation',
  })
}

/**
 * 別銀行戻し判別ルール（08d §1）の照合。当たらなければ用途不明を返す
 * （勤務先入金かどうかの判定は呼び出し側が続ける）。
 *
 * 勤務先を登録済みの利用者と未登録の利用者で判別の入口が分かれるため、
 * 両方が同じ実装を通るようにここへ寄せる（片側だけ直る事故を防ぐ）。
 */
function otherSavingsReturnOrUnknown(
  normalizedRemitterName: string,
  otherSavingsCounterpartyNames: readonly string[],
): DepositPurpose {
  return otherSavingsCounterpartyNames.includes(normalizedRemitterName)
    ? DepositPurposeSchema.parse({ kind: 'other_savings_return' })
    : awaitingManualConfirmation()
}

export interface BankDepositPurposeInput {
  /** 入金額（正） */
  amount: Money
  /** 入金の発生日時 */
  occurredAt: Date
  /** 振込元名。正規化前の生値でよい（本関数が正規化してから照合する） */
  remitterName: string
}

/**
 * behavior 銀行入金の用途を判別する（08d §2）
 *
 * 事後: 別銀行貯蓄口座からの入金 → 別銀行戻し判別
 * 事後: 勤務先からの入金 → 入金日シグナルと金額シグナルを突き合わせ、
 *       一致したときのみ 給与判別 / 経費精算入金判別 を自動確定する
 * 事後: 2 シグナルが矛盾する入金（例: 月内上中旬の 25 万円以上）→ 用途不明（手動確認待ち）
 * 事後: どのパターンにも当たらない振込元 → 用途不明（手動確認待ち）
 *
 * OQ-21: 給与と経費精算入金は同一の勤務先から同一の摘要で入るため、振込元名では
 * 区別できない。矛盾時に「25 万円以上は給与」と黙って倒すと、経費精算入金を給与と
 * 誤判定した月は突合が発火せず月次レポートが最終確定へ昇格しなくなるため、
 * 自動確定せずユーザーの判別を待つ。
 */
export function determineBankDepositPurpose(
  input: BankDepositPurposeInput,
  rule: BankDepositPurposeRule,
): DepositPurpose {
  const remitterName = normalizeRemitterName(input.remitterName)

  const otherSavingsOrUnknown = otherSavingsReturnOrUnknown(
    remitterName,
    rule.otherSavingsCounterpartyNames,
  )
  if (otherSavingsOrUnknown.kind === 'other_savings_return') return otherSavingsOrUnknown

  if (!rule.employerRemitterNames.includes(remitterName)) {
    return otherSavingsOrUnknown
  }

  const daySignal = depositDaySignal(input.occurredAt, rule.salaryPayoutDayWindow)
  const amountSignal = depositAmountSignal(input.amount, rule.salaryThresholdAmount)
  if (daySignal !== amountSignal) {
    return awaitingManualConfirmation()
  }
  return DepositPurposeSchema.parse({ kind: daySignal })
}

/**
 * behavior 銀行入金の用途を判別する を、利用者の勤務先振込元名簿を入口にして実行する
 * （08d §2、#448 / OQ-61）。
 *
 * 勤務先振込元名パターンは利用者ごとの名簿（`EmployerRemitterDirectory`）が正で、
 * 判別ルールはここで組み立てる。呼び出し側（日次メール取込バッチ #414 / #35）に
 * ルールの組み立てを持たせると、名簿を読まずに固定値で判別する経路が生まれる。
 *
 * 事後: 名簿が空（勤務先を一度も登録していない利用者）→ 別銀行戻しだけは判別し、
 *       それ以外は用途不明（手動確認待ち）。最初の 1 件を確認窓口で確定するときに
 *       名簿へ登録され、以後の同じ振込元は自動確定に乗る（OQ-61 ①）
 */
export function determineBankDepositPurposeForUser(
  input: BankDepositPurposeInput,
  directory: EmployerRemitterDirectory,
  ruleOptions: BankDepositPurposeRuleOptionsInput = {},
): DepositPurpose {
  // 名簿の中身に関わらず世帯共通の条件を検証する（名簿が空のあいだだけ不正な条件が
  // 素通りし、勤務先を 1 件登録した瞬間に落ちる、という挙動の割れを作らない）
  const options = bankDepositPurposeRuleOptions(ruleOptions)
  const employerRemitterNames = employerRemitterNamesOf(directory)
  if (employerRemitterNames.length === 0) {
    return otherSavingsReturnOrUnknown(
      normalizeRemitterName(input.remitterName),
      options.otherSavingsCounterpartyNames,
    )
  }
  return determineBankDepositPurpose(
    input,
    BankDepositPurposeRuleSchema.parse({ ...options, employerRemitterNames }),
  )
}

/**
 * 出金用途を判別する（08d §1 出金用途）。
 *
 * 入金用途判別ルールとは別語彙のため、必要な入力（別銀行貯蓄口座の相手方名パターン）だけを
 * 受け取る。カード引落は引落確定通知の消込経路（`applyUnpaidSettlementToSmbcBalance`）が
 * 持つためここでは扱わない。NISA 積立の判別は積立累計加算の実装（08d §2）と一緒に入れる。
 */
export function determineWithdrawalPurpose(
  input: { counterpartyName: string },
  otherSavingsCounterpartyNames: OtherSavingsCounterpartyNames,
): WithdrawalPurpose {
  const counterpartyName = normalizeRemitterName(input.counterpartyName)
  return WithdrawalPurposeSchema.parse(
    otherSavingsCounterpartyNames.includes(counterpartyName) ? 'other_savings_transfer' : 'other',
  )
}
