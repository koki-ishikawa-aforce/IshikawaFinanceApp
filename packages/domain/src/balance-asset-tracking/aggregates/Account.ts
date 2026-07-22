/**
 * 口座集約（残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/09-aggregates.md #9
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.1
 *
 * kawasima: data 口座 = SMBC銀行口座 OR 三井住友カード OR 別銀行貯蓄口座 OR NISA口座
 *
 * 不変条件:
 *  - 同一ユーザーID + 口座種別の組合せは一意（Repository.save 時にチェック、Phase 5）
 *  - 銀行名・証券会社名は所有者本人のみ変更可（Repository 呼び出し側で検証、Phase 5）
 */
import { z } from 'zod'
import {
  AccountIdSchema,
  UserIdSchema,
  MitsuiSumitomoUnpaidIdSchema,
  type AccountId,
  type UserId,
} from '../../shared/ids'
import { MoneySchema, addMoney, type Money } from '../../shared/value-objects/Money'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import { BankNameSchema, type BankName } from '../value-objects/BankName'
import { BrokerageNameSchema, type BrokerageName } from '../value-objects/BrokerageName'

/** data 口座種別 = SMBC銀行 OR 三井住友カード OR 別銀行貯蓄 OR NISA（08d §1） */
export const AccountKindSchema = z.enum([
  'smbc_bank',
  'mitsui_sumitomo_card',
  'other_savings',
  'nisa',
])
export type AccountKind = z.infer<typeof AccountKindSchema>

export const ActivenessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('active') }),
  z.object({
    kind: z.literal('inactive'),
    inactivatedAt: z.date(),
    reason: z.string(),
  }),
])
export type Activeness = z.infer<typeof ActivenessSchema>

export const CommonAccountAttrsSchema = z.object({
  accountId: AccountIdSchema,
  ownerUserId: UserIdSchema,
  registeredAt: z.date(),
  activeness: ActivenessSchema,
})
export type CommonAccountAttrs = z.infer<typeof CommonAccountAttrsSchema>

export const SmbcBalanceSchema = z.object({
  currentBalance: MoneySchema,
  initialBalance: MoneySchema,
  initialBalanceBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
})
export type SmbcBalance = z.infer<typeof SmbcBalanceSchema>

export const OtherSavingsBalanceSchema = z.object({
  currentBalance: MoneySchema,
  initialBalance: MoneySchema,
  initialBalanceBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
})
export type OtherSavingsBalance = z.infer<typeof OtherSavingsBalanceSchema>

export const NisaContributionSchema = z.object({
  currentAccumulated: MoneySchema,
  initialAccumulated: MoneySchema,
  initialAccumulatedBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
})
export type NisaContribution = z.infer<typeof NisaContributionSchema>

export const BalanceFreshnessSourceSchema = z.object({
  lastUpdatedAt: z.date(),
})
export type BalanceFreshnessSource = z.infer<typeof BalanceFreshnessSourceSchema>

export const AccountSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('smbc_bank'),
    common: CommonAccountAttrsSchema,
    balance: SmbcBalanceSchema,
  }),
  z.object({
    kind: z.literal('mitsui_sumitomo_card'),
    common: CommonAccountAttrsSchema,
    unpaidAggregateRef: MitsuiSumitomoUnpaidIdSchema,
  }),
  z.object({
    kind: z.literal('other_savings'),
    common: CommonAccountAttrsSchema,
    bankName: BankNameSchema,
    balance: OtherSavingsBalanceSchema,
    freshnessSource: BalanceFreshnessSourceSchema,
  }),
  z.object({
    kind: z.literal('nisa'),
    common: CommonAccountAttrsSchema,
    brokerageName: BrokerageNameSchema,
    contribution: NisaContributionSchema,
  }),
])
export type Account = z.infer<typeof AccountSchema>

export type SmbcBankAccount = Extract<Account, { kind: 'smbc_bank' }>
export type MitsuiSumitomoCardAccount = Extract<Account, { kind: 'mitsui_sumitomo_card' }>
export type OtherSavingsAccount = Extract<Account, { kind: 'other_savings' }>
export type NisaAccount = Extract<Account, { kind: 'nisa' }>

/**
 * behavior 口座をアプリに登録する（08d §2、別銀行貯蓄口座）
 * 設定画面・オンボーディング Phase 2-B からの登録。アクティブ状態で登録され、
 * 現在残高 = 初期残高、初期残高基準時刻・最終更新日時 = 登録日時（論点9: ユーザー入力時点）。
 *
 * 事前: 同種別の口座が未登録（集約境界をまたぐため Repository.save の一意制約が最終保証、
 * 09-aggregates #9）。ユーザーIDの許可リスト照合は認証済み viewer を渡す application 層が担う。
 */
export function registerOtherSavingsAccount(params: {
  accountId: AccountId
  ownerUserId: UserId
  bankName: BankName
  initialBalance: Money
  at: Date
}): OtherSavingsAccount {
  return AccountSchema.parse({
    kind: 'other_savings',
    common: {
      accountId: params.accountId,
      ownerUserId: params.ownerUserId,
      registeredAt: params.at,
      activeness: { kind: 'active' },
    },
    bankName: params.bankName,
    balance: {
      currentBalance: params.initialBalance,
      initialBalance: params.initialBalance,
      initialBalanceBaselineAt: params.at,
      lastUpdatedAt: params.at,
    },
    freshnessSource: { lastUpdatedAt: params.at },
  }) as OtherSavingsAccount
}

/**
 * behavior 口座をアプリに登録する（08d §2、NISA 口座）
 * 現在累計 = 初期累計、初期累計基準時刻・最終更新日時 = 登録日時。
 * 事前条件は registerOtherSavingsAccount と同じ（同種別未登録は Repository の一意制約が最終保証）。
 */
export function registerNisaAccount(params: {
  accountId: AccountId
  ownerUserId: UserId
  brokerageName: BrokerageName
  initialAccumulated: Money
  at: Date
}): NisaAccount {
  return AccountSchema.parse({
    kind: 'nisa',
    common: {
      accountId: params.accountId,
      ownerUserId: params.ownerUserId,
      registeredAt: params.at,
      activeness: { kind: 'active' },
    },
    brokerageName: params.brokerageName,
    contribution: {
      currentAccumulated: params.initialAccumulated,
      initialAccumulated: params.initialAccumulated,
      initialAccumulatedBaselineAt: params.at,
      lastUpdatedAt: params.at,
    },
  }) as NisaAccount
}

/**
 * behavior 別銀行貯蓄口座の銀行名を変更する（08d §2、Phase 3.5）
 * 「所有者本人のみ変更可（配偶者の口座名は変更不可）」の操作者検証は
 * application 層で行う（viewer 本人が所有する口座のみ渡す）。
 */
export function changeBankName(
  account: OtherSavingsAccount,
  bankName: BankName,
): OtherSavingsAccount {
  return AccountSchema.parse({ ...account, bankName }) as OtherSavingsAccount
}

/**
 * behavior NISA口座の証券会社名を変更する（08d §2、Phase 3.5）
 * 操作者検証（所有者本人のみ）は changeBankName と同じく application 層で行う。
 */
export function changeBrokerageName(
  account: NisaAccount,
  brokerageName: BrokerageName,
): NisaAccount {
  return AccountSchema.parse({ ...account, brokerageName }) as NisaAccount
}

/**
 * behavior 取引で口座残高を更新する（08d §2）
 * 事後: 経費(会社) 取引も含む全取引を反映する（家計分析と扱いが異なる）。
 * 入金は正の delta、出金・引落消込変動は負の delta として適用し、最終更新日時を進める。
 *
 * 不変条件: 非アクティブ口座への残高変動は適用しない（09-aggregates #9）。
 * 事前: 呼び出し側は変動の発生順に適用する（lastUpdatedAt は家計分析の残高鮮度評価に
 * 借用されるため、順不同適用は鮮度評価を狂わせる）。
 */
export function applySmbcBalanceChange(
  account: SmbcBankAccount,
  delta: Money,
  at: Date,
): SmbcBankAccount {
  if (account.common.activeness.kind === 'inactive') {
    throw new InvariantViolationError(
      `非アクティブ口座（${account.common.accountId}）へ残高変動は適用できない`,
    )
  }
  return AccountSchema.parse({
    ...account,
    balance: {
      ...account.balance,
      currentBalance: addMoney(account.balance.currentBalance, delta),
      lastUpdatedAt: at,
    },
  }) as SmbcBankAccount
}
