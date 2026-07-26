/**
 * 銀行入金集約（残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1 §2
 * @see docs/domain/03-open-questions.md OQ-21
 *
 * kawasima:
 *   data 入金変動 = 口座ID AND 取引ID AND 金額 AND 発生日時 AND 入金用途判別結果
 *   data 入金用途判別結果 = 給与判別 OR 経費精算入金判別 OR 別銀行戻し判別 OR 用途不明
 *   data 経費精算入金判別 = 取引ID AND 経費精算入金ID AND 判別日時
 *   data 用途不明 = 取引ID AND 判別日時 AND 暫定処理
 *
 * 入金変動そのものを集約として持つ。用途不明（手動確認待ち）の入金はユーザーがあとから
 * 用途を確定するまで残り続けるため、判別結果を永続化する置き場が要る。
 *
 * 不変条件:
 *  - 取引ID で一意（同一入金を二重に取り込まない。Repository の一意制約が最終保証）
 *  - 用途は「用途不明 → 確定」の一方向のみ。確定済みの入金の用途は変更できない
 *    （確定を起点にシャドウ残高の更新と経費精算入金到着イベントが走るため、
 *    後戻りを許すと二重減算・二重発火の余地が生まれる）
 *  - 経費精算入金判別は経費精算入金ID を必ず伴う（08d §1）。確定時に採番して保持し、
 *    イベントの再発行でも同じ ID を使う（購読側が冪等に扱えるようにする）
 *  - 入金金額は正（0 円・負の入金は入金変動として無意味）
 */
import { z } from 'zod'
import {
  AccountIdSchema,
  BankDepositIdSchema,
  ExpenseReimbursementIdSchema,
  TransactionIdSchema,
  UserIdSchema,
  type ExpenseReimbursementId,
  type UserId,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { InvariantViolationError, PermissionDeniedError } from '../../shared/errors/DomainError'
import {
  ProvisionalHandlingSchema,
  type DeterminedDepositPurpose,
} from '../value-objects/DepositPurpose'

/** 共通属性（08d: 入金変動の構成要素 + 判別日時） */
export const CommonBankDepositAttrsSchema = z.object({
  bankDepositId: BankDepositIdSchema,
  /** 入金先の SMBC 銀行口座 */
  accountId: AccountIdSchema,
  transactionId: TransactionIdSchema,
  /**
   * 入金の帰属ユーザー。給与・経費精算入金は個人に紐づく情報のため、
   * 参照・手動確認は本人に限る（プライバシー3段階ルール: 個人は相手に合計のみ）。
   */
  userId: UserIdSchema,
  amount: MoneySchema.refine(v => v > 0, '入金金額は正である必要があります'),
  occurredAt: z.date(),
  /** 正規化済み振込元名。判別の根拠であり、手動確認の画面表示にも使う */
  remitterName: z.string().min(1),
  determinedAt: z.date(),
})
export type CommonBankDepositAttrs = z.infer<typeof CommonBankDepositAttrsSchema>

/**
 * 用途の確定経路。手動確認で確定した入金を自動確定と区別する
 * （判別ルールの精度を後から検証できるようにする）。
 */
export const DeterminationSourceSchema = z.enum(['automatic', 'manual'])
export type DeterminationSource = z.infer<typeof DeterminationSourceSchema>

export const BankDepositSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('salary'),
    common: CommonBankDepositAttrsSchema,
    determinationSource: DeterminationSourceSchema,
  }),
  z.object({
    kind: z.literal('expense_reimbursement'),
    common: CommonBankDepositAttrsSchema,
    expenseReimbursementId: ExpenseReimbursementIdSchema,
    determinationSource: DeterminationSourceSchema,
  }),
  z.object({
    kind: z.literal('other_savings_return'),
    common: CommonBankDepositAttrsSchema,
    determinationSource: DeterminationSourceSchema,
  }),
  z.object({
    kind: z.literal('unknown'),
    common: CommonBankDepositAttrsSchema,
    provisionalHandling: ProvisionalHandlingSchema,
  }),
])
export type BankDeposit = z.infer<typeof BankDepositSchema>

export type UnknownBankDeposit = Extract<BankDeposit, { kind: 'unknown' }>
export type DeterminedBankDeposit = Exclude<BankDeposit, UnknownBankDeposit>

/** 用途が確定済みか（用途不明でないか）を判定する */
export function isDeterminedBankDeposit(deposit: BankDeposit): deposit is DeterminedBankDeposit {
  return deposit.kind !== 'unknown'
}

function buildDetermined(params: {
  purpose: DeterminedDepositPurpose
  common: CommonBankDepositAttrs
  expenseReimbursementId: ExpenseReimbursementId
  determinationSource: DeterminationSource
}): DeterminedBankDeposit {
  const base = { common: params.common, determinationSource: params.determinationSource }
  return BankDepositSchema.parse(
    params.purpose === 'expense_reimbursement'
      ? { kind: params.purpose, ...base, expenseReimbursementId: params.expenseReimbursementId }
      : { kind: params.purpose, ...base },
  ) as DeterminedBankDeposit
}

/**
 * behavior 銀行入金の用途を判別する の出力を集約に組み立てる（08d §2）。
 * 判別そのものは `determineBankDepositPurpose`（services）が行う。
 *
 * `expenseReimbursementId` は経費精算入金判別のときだけ使う。用途は判別してみるまで
 * 決まらないため、呼び出し側は常に採番して渡す（使われなければ捨てられる）。
 */
export function recordBankDeposit(params: {
  common: CommonBankDepositAttrs
  purpose: DeterminedDepositPurpose | 'unknown'
  expenseReimbursementId: ExpenseReimbursementId
}): BankDeposit {
  if (params.purpose === 'unknown') {
    return BankDepositSchema.parse({
      kind: 'unknown',
      common: params.common,
      provisionalHandling: 'awaiting_manual_confirmation',
    })
  }
  return buildDetermined({
    purpose: params.purpose,
    common: params.common,
    expenseReimbursementId: params.expenseReimbursementId,
    determinationSource: 'automatic',
  })
}

/**
 * 状態遷移: 用途不明 → 確定（手動確認、08d §1 暫定処理 = 手動確認待ち）
 *
 * 事前: 操作者 = 入金の帰属ユーザー本人。配偶者は給与・経費精算入金の内訳を
 * 見ることも確定することもできない（プライバシー3段階ルール）。
 * 事前: 用途不明の入金のみ。確定済みは `InvariantViolationError`（一方向遷移）。
 */
export function confirmBankDepositPurpose(
  deposit: BankDeposit,
  params: {
    purpose: DeterminedDepositPurpose
    operatorUserId: UserId
    expenseReimbursementId: ExpenseReimbursementId
    at: Date
  },
): DeterminedBankDeposit {
  if (deposit.common.userId !== params.operatorUserId) {
    throw new PermissionDeniedError(
      `入金（${deposit.common.bankDepositId}）の用途を確定できるのは帰属ユーザー本人のみ`,
    )
  }
  if (isDeterminedBankDeposit(deposit)) {
    throw new InvariantViolationError(
      `入金（${deposit.common.bankDepositId}）の用途は確定済み（${deposit.kind}）のため変更できない`,
    )
  }
  return buildDetermined({
    purpose: params.purpose,
    common: { ...deposit.common, determinedAt: params.at },
    expenseReimbursementId: params.expenseReimbursementId,
    determinationSource: 'manual',
  })
}
