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
 *  - 銀行名・証券会社名は所有者本人のみ変更可（changeBankName / changeBrokerageName が
 *    操作者ユーザーID で検証する、08d §2）
 */
import { z } from 'zod'
import {
  AccountIdSchema,
  UserIdSchema,
  MitsuiSumitomoUnpaidIdSchema,
  SettlementNoticeIdSchema,
  TransactionIdSchema,
  type AccountId,
  type UserId,
  type SettlementNoticeId,
  type TransactionId,
} from '../../shared/ids'
import { MoneySchema, addMoney, money, type Money } from '../../shared/value-objects/Money'
import {
  InvariantViolationError,
  OtherSavingsMovementAlreadyAppliedError,
  PermissionDeniedError,
  UnpaidSettlementAlreadyAppliedError,
} from '../../shared/errors/DomainError'
import { BankNameSchema, type BankName } from '../value-objects/BankName'
import { BrokerageNameSchema, type BrokerageName } from '../value-objects/BrokerageName'

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
  /**
   * 残高へ反映済みの引落確定通知IDの集合（#388）。
   * 未払金消込の残高反映を口座側で冪等にするための記録で、未反映なら空。
   * 既存データ（この項目を持たない payload）は空配列として読み出される。
   *
   * 「最後に反映した1件」ではなく集合で持つ。単数だと A → B と反映した後に A が
   * 再送された場合（メール再取込によるバックフィル等）にガードを素通りし、
   * A の消込分が二重に減算されるため。消込済みエントリを恒久保持する未払金集約
   * （08d §1）と同じく、月に1件ずつしか増えない。
   */
  appliedSettlementNoticeIds: z.array(SettlementNoticeIdSchema).default([]),
})
export type SmbcBalance = z.infer<typeof SmbcBalanceSchema>

export const OtherSavingsBalanceSchema = z.object({
  currentBalance: MoneySchema,
  initialBalance: MoneySchema,
  initialBalanceBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
  /**
   * シャドウ残高へ反映済みの資金移動の取引IDの集合（#390）。
   * SMBC 残高側の `appliedSettlementNoticeIds` と同じ役割で、未反映なら空。
   * 既存データ（この項目を持たない payload）は空配列として読み出される。
   *
   * 別銀行貯蓄口座は実残高を取得できないシャドウ口座で、SMBC 側の資金移動から
   * 差分を積み上げてしか残高を知れない。加減算が二重に走ると実態との差が恒久的に
   * 残る（引落消込と違って外部の正解と突き合わせて直せない）ため、適用元を記録して
   * 二度目を拒否する。手入力（取り崩し記録・残高補正）は取引を持たないため対象外。
   */
  appliedMovementTransactionIds: z.array(TransactionIdSchema).default([]),
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

/** 口座を別銀行貯蓄口座として絞り込む。種別不一致は InvariantViolationError */
export function asOtherSavingsAccount(account: Account): OtherSavingsAccount {
  if (account.kind !== 'other_savings') {
    throw new InvariantViolationError(
      `銀行名を変更できるのは別銀行貯蓄口座のみ（現種別: ${account.kind}）`,
    )
  }
  return account
}

/** 口座を NISA 口座として絞り込む。種別不一致は InvariantViolationError */
export function asNisaAccount(account: Account): NisaAccount {
  if (account.kind !== 'nisa') {
    throw new InvariantViolationError(
      `証券会社名を変更できるのは NISA 口座のみ（現種別: ${account.kind}）`,
    )
  }
  return account
}

/**
 * behavior 別銀行貯蓄口座の銀行名を変更する（08d §2、Phase 3.5）
 * 事前: 操作者 = 口座所有者本人（配偶者の口座名は変更不可）。
 * 違反は PermissionDeniedError を throw する（09-aggregates #9 の不変条件）。
 */
export function changeBankName(
  account: OtherSavingsAccount,
  bankName: BankName,
  operatorUserId: UserId,
): OtherSavingsAccount {
  if (account.common.ownerUserId !== operatorUserId) {
    throw new PermissionDeniedError(
      '銀行名は口座所有者本人のみ変更できる（配偶者の口座は変更不可）',
    )
  }
  return AccountSchema.parse({ ...account, bankName }) as OtherSavingsAccount
}

/**
 * behavior NISA口座の証券会社名を変更する（08d §2、Phase 3.5）
 * 事前: 操作者 = 口座所有者本人。違反は PermissionDeniedError を throw する。
 */
export function changeBrokerageName(
  account: NisaAccount,
  brokerageName: BrokerageName,
  operatorUserId: UserId,
): NisaAccount {
  if (account.common.ownerUserId !== operatorUserId) {
    throw new PermissionDeniedError(
      '証券会社名は口座所有者本人のみ変更できる（配偶者の口座は変更不可）',
    )
  }
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

/**
 * behavior 別銀行貯蓄残高を手入力で更新する（08d §2、取り崩し記録 / 残高補正）
 * シャドウ口座（実残高を直接取得できない別銀行貯蓄口座）の残高を動かす基本操作。
 * 加算は正の delta、減算は負の delta。
 *
 * 事後: 別銀行貯蓄残高の最終更新日時が更新される。残高鮮度の根拠（08d §1 残高鮮度供給）も
 * 同じ時刻へ進める。家計分析はこの値で「最終更新から N 日」を評価するため、残高だけ動かして
 * 鮮度を据え置くと、更新されているのに古いと表示される。
 *
 * 不変条件: 非アクティブ口座への残高変動は適用しない（09-aggregates #9）。
 *
 * 取引に由来する資金移動（SMBC 振込・別銀行戻し）には使わないこと。二重適用のガードが
 * 無いため、再実行で残高が二重に動く。そちらは `applyOtherSavingsMovement` を使う。
 */
export function applyOtherSavingsBalanceChange(
  account: OtherSavingsAccount,
  delta: Money,
  at: Date,
): OtherSavingsAccount {
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
    freshnessSource: { lastUpdatedAt: at },
  }) as OtherSavingsAccount
}

/**
 * behavior 別銀行貯蓄残高をSMBC振込で加算する / 別銀行戻しで減算する（08d §2、#390）
 * SMBC 側の資金移動 1 件（取引）をシャドウ残高へ反映する。加算は正の delta、減算は負の delta。
 *
 * 不変条件: 同一の取引は一度しかシャドウ残高へ反映しない（適用済み取引IDの集合で判定）。
 * 二度目は `OtherSavingsMovementAlreadyAppliedError` を throw する。呼び出し側は
 * 「反映済みのためスキップ」として扱ってよい。
 *
 * 入金の用途確定（`confirmBankDepositPurpose`）とこの反映は別集約への順次保存であり、
 * その間で失敗するとシャドウ残高だけが未反映で残る。同じ用途での確定は冪等に再実行できる
 * ため、呼び出し側は再実行でここまで到達させてよく、二重適用はこのガードが防ぐ
 * （OQ-43「集約をまたぐ更新は再実行で自己修復する」）。
 *
 * 事後: 最終更新日時・残高鮮度の根拠は巻き戻さない。回復は定義上「遅れて古い移動を
 * 適用する」ため、発生順に適用するという前提を満たせない。
 */
export function applyOtherSavingsMovement(
  account: OtherSavingsAccount,
  params: { transactionId: TransactionId; delta: Money; at: Date },
): OtherSavingsAccount {
  if (account.balance.appliedMovementTransactionIds.includes(params.transactionId)) {
    throw new OtherSavingsMovementAlreadyAppliedError(
      `資金移動（取引 ${params.transactionId}）は別銀行貯蓄口座（${account.common.accountId}）へ反映済みのため再反映できない`,
    )
  }
  const applied = applyOtherSavingsBalanceChange(account, params.delta, params.at)
  const lastUpdatedAt =
    params.at > account.balance.lastUpdatedAt ? params.at : account.balance.lastUpdatedAt
  return AccountSchema.parse({
    ...applied,
    balance: {
      ...applied.balance,
      lastUpdatedAt,
      appliedMovementTransactionIds: [
        ...applied.balance.appliedMovementTransactionIds,
        params.transactionId,
      ],
    },
    freshnessSource: { lastUpdatedAt },
  }) as OtherSavingsAccount
}

/**
 * behavior 引落消込を口座残高へ反映する（08d §2、#388）
 * 事後: 消込合計だけ現在残高を減算し、反映元の引落確定通知IDを記録する。
 *
 * 不変条件: 同一の引落確定通知は一度しか残高へ反映しない（09-aggregates #9）。
 * 反映順に関わらず、過去に反映したどの通知でも二度目は
 * UnpaidSettlementAlreadyAppliedError を throw する。
 *
 * 未払金の消込（settleUnpaid）と本反映は別集約への順次保存であり、その間で
 * 失敗すると残高だけが未反映で残る。呼び出し側は同一イベントの再実行で必ず
 * ここまで到達させてよく、二重減算はこのガードが防ぐ（OQ-43「再実行で自己修復」）。
 *
 * 事後: 最終更新日時は巻き戻さない。回復は定義上「遅れて古い通知を適用する」ため、
 * applySmbcBalanceChange の事前条件（変動の発生順に適用する）を満たせない。
 */
export function applyUnpaidSettlementToSmbcBalance(
  account: SmbcBankAccount,
  params: { settlementNoticeId: SettlementNoticeId; settledTotal: Money; at: Date },
): SmbcBankAccount {
  if (account.balance.appliedSettlementNoticeIds.includes(params.settlementNoticeId)) {
    throw new UnpaidSettlementAlreadyAppliedError(
      `引落確定通知（${params.settlementNoticeId}）は口座（${account.common.accountId}）の残高へ反映済みのため再反映できない`,
    )
  }
  const applied = applySmbcBalanceChange(account, money(-params.settledTotal), params.at)
  return AccountSchema.parse({
    ...applied,
    balance: {
      ...applied.balance,
      // 回復（遅れて古い通知を適用する）で最終更新日時が過去へ巻き戻らないようにする。
      // この値は家計分析の残高鮮度評価に借用されるため、巻き戻すと残高が実際より
      // 古い情報に見える（金額は正しいまま）。
      lastUpdatedAt:
        params.at > account.balance.lastUpdatedAt ? params.at : account.balance.lastUpdatedAt,
      appliedSettlementNoticeIds: [
        ...applied.balance.appliedSettlementNoticeIds,
        params.settlementNoticeId,
      ],
    },
  }) as SmbcBankAccount
}
