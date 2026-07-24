/**
 * 経費精算の最終確定サービス（経費精算コンテキスト）
 * @see docs/domain/08e-ul-経費精算.md §2
 * @see docs/domain/09-aggregates.md #11 #13
 * @see docs/domain/03-open-questions.md OQ-49
 *
 * 「月次経費サイクル」と「経費精算入金」の2集約にまたがる最終確定の不変条件を、
 * ここに一元的に置く（CLAUDE.md「ドメイン不変条件を adapters/api 層で再実装しない」）。
 * API 層は viewer の役割解決と永続化のみを担い、検証はこのサービスへ委譲する。
 *
 * 不変条件:
 *  - 不認定分の振替先は操作者本人の個人費用区分のみ（相手への誤帰属を防ぐ）
 *  - 不認定分（差額 > 0）があるときは「振替合計 = 差額」を満たす振替が必須
 *    （振替0件のまま確定して入金が中間状態「突合済み」に留まる不整合を原理的に防ぐ、OQ-49 ①）
 *  - 不認定分がない突合結果では振替を指定できない
 */
import { InvariantViolationError } from '../../shared/errors/DomainError'
import type { PersonalExpenseClass } from '../../shared/value-objects/PersonalExpenseClass'
import type { UnapprovedExpenseTransfer } from '../../shared/value-objects/UnapprovedExpenseTransfer'
import {
  calculateSettlementMatchDifference,
  finalizeCycle,
  type CsvConfirmedCycle,
  type FinalizedCycle,
} from '../aggregates/MonthlyExpenseCycle'
import {
  confirmUnrecognizedDeposit,
  matchDeposit,
  type AwaitingMatchDeposit,
  type MatchedDeposit,
  type UnrecognizedConfirmedDeposit,
} from '../aggregates/ExpenseReimbursementDeposit'

export interface FinalizeExpenseSettlementResult {
  cycle: FinalizedCycle
  // 最終確定で終端状態まで進めた入金。不認定分の有無で終端が
  // 突合済み（matched）／不認定分確定済み（unrecognized_confirmed）に分岐する。
  deposit: MatchedDeposit | UnrecognizedConfirmedDeposit
}

/**
 * 確定済みサイクルと突合待ち入金から、入金を終端状態まで進める。
 * 不認定分（差額 > 0）を伴う確定なら「不認定分確定済み」まで、そうでなければ「突合済み」で止める。
 * サイクルの `unapprovedTransfers` を一次情報とするため、最終確定・復旧の双方の経路で共有できる。
 */
export function settleDepositForFinalizedCycle(
  cycle: FinalizedCycle,
  deposit: AwaitingMatchDeposit,
  at: Date,
): MatchedDeposit | UnrecognizedConfirmedDeposit {
  const matched = matchDeposit(deposit, cycle.common.monthlyExpenseCycleId, at)
  const difference = calculateSettlementMatchDifference(cycle, deposit.common.depositAmount)
  if (cycle.unapprovedTransfers.length > 0 && difference.kind === 'unapproved_shortfall') {
    return confirmUnrecognizedDeposit(matched, difference.difference, at)
  }
  return matched
}

/**
 * CSV 確定サイクルと突合待ち入金から、最終確定サイクル + 終端まで進めた入金を導出する。
 * 最終確定の不変条件（上記）をすべて強制する。違反時は状態を変えず throw する。
 */
export function finalizeExpenseSettlement(
  cycle: CsvConfirmedCycle,
  deposit: AwaitingMatchDeposit,
  transfers: UnapprovedExpenseTransfer[],
  ownExpenseClass: PersonalExpenseClass,
  at: Date,
): FinalizeExpenseSettlementResult {
  // 振替先は操作者本人の個人費用区分のみ（不認定分を相手の個人合計へ誤帰属させない、08e §2）。
  // 相手の区分を指定するのは「他人の集約への越権」ではなく「本人が区分を取り違えた＝配偶者の
  // 個人支出合計がズレる整合性違反」であるため、不変条件違反（409）で弾く。OQ-48（区分の取り違えは
  // 不変条件としてドメイン層で弾く）と用語をそろえる（OQ-51、2026-07-24 判断セッション / #127）。
  for (const transfer of transfers) {
    if (transfer.transferTarget !== ownExpenseClass) {
      throw new InvariantViolationError('不認定分の振替先は操作者本人の個人費用区分のみ指定できる')
    }
  }

  const difference = calculateSettlementMatchDifference(cycle, deposit.common.depositAmount)
  if (difference.kind === 'unapproved_shortfall') {
    // 不認定分があるなら振替必須（OQ-49 ①）。振替0件のまま確定させない
    if (transfers.length === 0) {
      throw new InvariantViolationError(
        `不認定分（差額 ${difference.difference}）があるため、振替の指定が必須（振替合計が差額と一致する必要がある）`,
      )
    }
    const transferTotal = transfers.reduce((total, transfer) => total + transfer.transferAmount, 0)
    if (transferTotal !== difference.difference) {
      throw new InvariantViolationError(
        `不認定分振替の合計（${transferTotal}）が突合差額（${difference.difference}）と一致しない`,
      )
    }
  } else if (transfers.length > 0) {
    throw new InvariantViolationError(
      '不認定分（入金額が当月経費合計を下回る差額）がない突合結果では振替を指定できない',
    )
  }

  const finalized = finalizeCycle(cycle, deposit.common.expenseReimbursementId, transfers, at)
  const settledDeposit = settleDepositForFinalizedCycle(finalized, deposit, at)
  return { cycle: finalized, deposit: settledDeposit }
}
