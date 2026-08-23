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
 *  - 別銀行貯蓄残高・NISA 積立累計は負にならない（#397。取り崩し・手動補正・初期残高修正の
 *    各ドメイン関数が事前条件として検証する）。SMBC 残高には課さない — 通知由来の変動を
 *    そのまま反映する設計（applySmbcBalanceChange）で、引落が入金より先に届けば一時的に
 *    負になりうるため
 *  - 手入力（取り崩し記録・残高補正・積立累計補正）は 1 件ごとに操作記録として口座に積む
 *    （#459 / #458。08d §1 `List<シャドウ口座更新>` `List<NISA積立累計更新>` の手入力由来分）。
 *    記録は追記のみで書き換え・削除はしない
 *  - 読み出してから保存するまでに他の処理が同じ口座を更新していたら書き込まない
 *    （#459。版数 `common.version` を Repository.save が照合する）
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
  type MitsuiSumitomoUnpaidId,
  type SettlementNoticeId,
  type TransactionId,
} from '../../shared/ids'
import {
  MoneySchema,
  addMoney,
  money,
  subtractMoney,
  type Money,
} from '../../shared/value-objects/Money'
import {
  InvariantViolationError,
  OtherSavingsMovementAlreadyAppliedError,
  PermissionDeniedError,
  UnpaidSettlementAlreadyAppliedError,
} from '../../shared/errors/DomainError'
import { BankNameSchema, type BankName } from '../value-objects/BankName'
import { InactivationReasonSchema } from '../value-objects/InactivationReason'
import { BrokerageNameSchema, type BrokerageName } from '../value-objects/BrokerageName'
import { ManualEntryMemoSchema } from '../value-objects/ManualEntryMemo'
import {
  OtherSavingsManualEntrySchema,
  type OtherSavingsManualEntry,
} from '../value-objects/OtherSavingsManualEntry'
import { NisaManualEntrySchema, type NisaManualEntry } from '../value-objects/NisaManualEntry'

export const ActivenessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('active') }),
  z.object({
    kind: z.literal('inactive'),
    inactivatedAt: z.date(),
    /**
     * 書き込みは `InactivationReasonSchema`（1〜100 文字）で検証する。ここを同じ制約に
     * しないのは、制約を満たさない既存 payload があっても口座を読み出せなくしないため
     * （読めないと再アクティブ化での復旧すら塞がる）。
     */
    reason: z.string(),
  }),
])
export type Activeness = z.infer<typeof ActivenessSchema>

export const CommonAccountAttrsSchema = z.object({
  accountId: AccountIdSchema,
  ownerUserId: UserIdSchema,
  registeredAt: z.date(),
  activeness: ActivenessSchema,
  /**
   * 版数（楽観ロックのトークン。#459）。読み出した口座が「いつの状態か」を表し、
   * Repository.save はこの値が保存先の現在の版と一致するときだけ書き込む
   * （不一致は `ConcurrentUpdateError`）。書き込みに成功した保存先の版は 1 進む。
   *
   * ドメイン関数はこの値を触らない。同じ版のまま新しい状態を返し、書き込み時に
   * 「読んだときから変わっていないこと」を照合するのが役割だから。
   * 既存データ（この項目を持たない payload・版数列が無かった頃の行）は 0 として読み出される。
   */
  version: z.number().int().nonnegative().default(0),
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
  /**
   * 手入力（取り崩し記録・残高補正）の操作記録（#459。08d §1 `List<シャドウ口座更新>` の
   * 手入力由来分）。古い順に積む追記専用のリストで、既存データ（この項目を持たない payload）は
   * 空配列として読み出される。
   *
   * 手入力は取引を持たないため、残さないと残高の数字以外に痕跡が無く、
   * 「いつ誰がいくら動かしたか」も「二重に登録していないか」も後から確かめられない。
   */
  manualEntries: z.array(OtherSavingsManualEntrySchema).default([]),
})
export type OtherSavingsBalance = z.infer<typeof OtherSavingsBalanceSchema>

export const NisaContributionSchema = z.object({
  currentAccumulated: MoneySchema,
  initialAccumulated: MoneySchema,
  initialAccumulatedBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
  /**
   * 手入力（積立累計の補正）の操作記録（#458。08d §1 `List<NISA積立累計更新>` の手入力由来分）。
   * 古い順に積む追記専用のリストで、既存データ（この項目を持たない payload）は
   * 空配列として読み出される。
   *
   * 別銀行貯蓄の `manualEntries` と同じ理由で持つ。手入力は取引を持たないため、残さないと
   * 累計の数字以外に痕跡が無く、「いつ誰がいくらへ直したか」も「二重に直していないか」も
   * 後から確かめられない。
   */
  manualEntries: z.array(NisaManualEntrySchema).default([]),
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
 * 手入力の残高（登録時の初期残高・初期累計、補正後残高、修正後初期残高）の入力制約。
 * 「上限以下」は入力形式なので ZodError（API 層で 400）、「負にしない」は口座の状態に対する
 * 不変条件なので InvariantViolationError（同 409）と、翻訳先も含めて 1 か所に揃える。
 *
 * 登録・補正・後修正のどれにも同じ制約を課す。登録にだけ制約が無いと、登録時に入れた誤った桁を
 * 後から直せない（直そうとした値の方が弾かれる）状態になる。
 *
 * label は拒否された値が何かを利用者向けの言葉で示すためのもの（「初期残高」「初期累計」など）。
 */
function parseBalanceInput(value: Money, label: string): Money {
  const parsed = BalanceInputSchema.parse(value)
  if (parsed < 0) {
    throw new InvariantViolationError(`${label}は負にできない（${parsed}）`)
  }
  return parsed
}

/**
 * behavior 口座をアプリに登録する（08d §2、SMBC 銀行口座）
 * 設定画面・オンボーディング Phase 2-B からの登録。アクティブ状態で登録され、
 * 現在残高 = 初期残高、初期残高基準時刻・最終更新日時 = 登録日時（論点9: ユーザー入力時点）。
 * 反映済み引落確定通知IDは空（登録直後は何も消し込んでいない）。
 *
 * 初期残高は利用者が通帳・アプリを見て手入力する値のため、`correctInitialBalance` と同じ
 * 入力制約（0 円以上・上限以下）を課す。登録後の残高変動には課さない（引落が入金より先に
 * 届けば一時的に負になりうる — 冒頭の不変条件コメント参照）。
 *
 * 事前条件は registerOtherSavingsAccount と同じ（同種別未登録は Repository の一意制約が最終保証）。
 */
export function registerSmbcBankAccount(params: {
  accountId: AccountId
  ownerUserId: UserId
  initialBalance: Money
  at: Date
}): SmbcBankAccount {
  const initialBalance = parseBalanceInput(params.initialBalance, '初期残高')
  return AccountSchema.parse({
    kind: 'smbc_bank',
    common: {
      accountId: params.accountId,
      ownerUserId: params.ownerUserId,
      registeredAt: params.at,
      activeness: { kind: 'active' },
    },
    balance: {
      currentBalance: initialBalance,
      initialBalance,
      initialBalanceBaselineAt: params.at,
      lastUpdatedAt: params.at,
      appliedSettlementNoticeIds: [],
    },
  }) as SmbcBankAccount
}

/**
 * behavior 口座をアプリに登録する（08d §2、三井住友カード口座）
 * カードは残高ではなく未払金集約が正（08d §1）のため初期残高を受け取らず、未払金集約への
 * 参照を持つ。参照先の集約（`openMitsuiSumitomoUnpaid`）は口座と対で作り、永続化は
 * 口座を先に行う（未払金集約の口座IDが口座への外部キーのため）。対の作成が中断して
 * 未払金集約が欠けると、カード利用の計上が「未払金集約が見つからない」で落ち続けるため、
 * 呼び出し側は再実行で対を揃え直せる形にする。
 *
 * 事前条件は registerOtherSavingsAccount と同じ（同種別未登録は Repository の一意制約が最終保証）。
 */
export function registerMitsuiSumitomoCardAccount(params: {
  accountId: AccountId
  ownerUserId: UserId
  unpaidAggregateRef: MitsuiSumitomoUnpaidId
  at: Date
}): MitsuiSumitomoCardAccount {
  return AccountSchema.parse({
    kind: 'mitsui_sumitomo_card',
    common: {
      accountId: params.accountId,
      ownerUserId: params.ownerUserId,
      registeredAt: params.at,
      activeness: { kind: 'active' },
    },
    unpaidAggregateRef: params.unpaidAggregateRef,
  }) as MitsuiSumitomoCardAccount
}

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
  const initialBalance = parseBalanceInput(params.initialBalance, '初期残高')
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
      currentBalance: initialBalance,
      initialBalance,
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
  const initialAccumulated = parseBalanceInput(params.initialAccumulated, '初期累計')
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
      currentAccumulated: initialAccumulated,
      initialAccumulated,
      initialAccumulatedBaselineAt: params.at,
      lastUpdatedAt: params.at,
    },
  }) as NisaAccount
}

/**
 * 口座を別銀行貯蓄口座として絞り込む。種別不一致は InvariantViolationError。
 * operation は種別を要求している操作名（既定は銀行名の変更）。呼び出し側が複数あるため、
 * エラーメッセージが実際に拒否された操作を指すよう受け取る。
 */
export function asOtherSavingsAccount(
  account: Account,
  operation = '銀行名の変更',
): OtherSavingsAccount {
  if (account.kind !== 'other_savings') {
    throw new InvariantViolationError(
      `${operation}ができるのは別銀行貯蓄口座のみ（現種別: ${account.kind}）`,
    )
  }
  return account
}

/** 口座を NISA 口座として絞り込む。種別不一致は InvariantViolationError */
export function asNisaAccount(account: Account, operation = '証券会社名の変更'): NisaAccount {
  if (account.kind !== 'nisa') {
    throw new InvariantViolationError(
      `${operation}ができるのは NISA 口座のみ（現種別: ${account.kind}）`,
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

// --- #397: 残高の手動操作（取り崩し・手動補正・初期残高の後修正・非アクティブ化） ---

/**
 * 手入力・振込由来の金額の上限（10 億円）。夫婦2人の家計で扱う口座残高としては
 * 十分に大きく、桁の打ち間違いを弾ける水準に置く。上限が無いと Money の安全整数域
 * （約 9,007 兆）まで通り、その値が世帯資産合計にそのまま流れる。
 */
export const BALANCE_INPUT_LIMIT = 1_000_000_000

/**
 * 手入力・振込由来の金額は 1 円以上・上限以下（08d §2 の各振る舞いはいずれも「加算」「減算」で
 * あり、0 円・負の金額の入力は変動として意味を持たない）。違反は ZodError（API 層で 400）。
 */
const PositiveMoneySchema = MoneySchema.refine(v => v > 0 && v <= BALANCE_INPUT_LIMIT, {
  message: `金額は 1 円以上 ${BALANCE_INPUT_LIMIT} 円以下である必要がある`,
})

/**
 * 手入力の残高（補正後残高・修正後初期残高）の上限。
 * 「負にしない」は口座の状態に対する不変条件なので、入力形式ではなく各関数が
 * InvariantViolationError で表す（下限はここでは課さない）。
 */
const BalanceInputSchema = MoneySchema.refine(v => v <= BALANCE_INPUT_LIMIT, {
  message: `残高は ${BALANCE_INPUT_LIMIT} 円以下である必要がある`,
})

/**
 * 手入力の操作者が口座所有者本人であることを検証する（08d §2「入力者ユーザーID = 口座所有者ユーザーID」）。
 * 配偶者の口座残高を手入力で動かせないようにする不変条件。
 */
function assertOperatedByOwner(account: Account, operatorUserId: UserId, operation: string): void {
  if (account.common.ownerUserId !== operatorUserId) {
    throw new PermissionDeniedError(`${operation}は口座所有者本人のみ実行できる`)
  }
}

function assertActive(account: Account, operation: string): void {
  if (account.common.activeness.kind === 'inactive') {
    throw new InvariantViolationError(
      `非アクティブ口座（${account.common.accountId}）に${operation}は適用できない`,
    )
  }
}

/**
 * 別銀行貯蓄口座の現在残高を差し替える（本ファイル内の共通処理）。
 * 最終更新日時と残高鮮度根拠を同じ時刻へ進める。鮮度根拠は家計分析の残高鮮度評価が
 * 借用する値（08d §1）で、手入力で残高を確認した時点が最新の鮮度になる。
 */
function replaceOtherSavingsBalance(
  account: OtherSavingsAccount,
  newBalance: Money,
  at: Date,
): OtherSavingsAccount {
  return AccountSchema.parse({
    ...account,
    balance: { ...account.balance, currentBalance: newBalance, lastUpdatedAt: at },
    freshnessSource: { lastUpdatedAt: at },
  }) as OtherSavingsAccount
}

/**
 * behavior 別銀行貯蓄残高をSMBC振込で加算する（08d §2）
 * 事前: 出金用途 = 別銀行振込用（判別は呼び出し側 = 出金用途判別の責務）。
 * 事後: 別銀行貯蓄残高の最終更新日時が更新される。
 *
 * 振込由来の自動反映のため操作者検証は行わない（手入力ではない）。
 */
export function addOtherSavingsBySmbcTransfer(
  account: OtherSavingsAccount,
  params: { amount: Money; at: Date },
): OtherSavingsAccount {
  assertActive(account, '振込による残高加算')
  const amount = PositiveMoneySchema.parse(params.amount)
  return replaceOtherSavingsBalance(
    account,
    addMoney(account.balance.currentBalance, amount),
    params.at,
  )
}

/**
 * 手入力の操作記録を口座へ 1 件積む（#459）。追記のみで、既存の記録は書き換えない。
 * メモ未指定のときは項目ごと省く（`exactOptionalPropertyTypes` 下で undefined を持たせない）。
 */
function appendManualEntry(
  account: OtherSavingsAccount,
  entry: OtherSavingsManualEntry,
): OtherSavingsAccount {
  return AccountSchema.parse({
    ...account,
    balance: { ...account.balance, manualEntries: [...account.balance.manualEntries, entry] },
  }) as OtherSavingsAccount
}

/** 手入力に添えるメモを検証する。未指定はそのまま未指定として扱う */
function parseMemo(memo: string | undefined): { memo: string } | Record<string, never> {
  return memo === undefined ? {} : { memo: ManualEntryMemoSchema.parse(memo) }
}

/**
 * behavior 別銀行貯蓄残高を取り崩しで減算する（08d §2）
 * 事前: 入力者ユーザーID = 口座所有者ユーザーID。
 *
 * 不変条件: 取り崩し後の残高は負にならない（口座にある額を超えて取り崩せない）。
 * 違反は InvariantViolationError（API 層で 409）。
 *
 * 事後: 取り崩し手入力（入力者・金額・入力日時・メモ）が操作記録に 1 件積まれる（#459）。
 * 拒否された取り崩し（残高超過・非アクティブ・他人の口座）は記録に残らない — 残高が
 * 動いていない以上、後から履歴を読む人にとって「起きなかったこと」だから。
 */
export function withdrawOtherSavings(
  account: OtherSavingsAccount,
  params: { amount: Money; operatorUserId: UserId; at: Date; memo?: string },
): OtherSavingsAccount {
  assertOperatedByOwner(account, params.operatorUserId, '取り崩しの記録')
  assertActive(account, '取り崩し')
  const amount = PositiveMoneySchema.parse(params.amount)
  const memo = parseMemo(params.memo)
  const newBalance = subtractMoney(account.balance.currentBalance, amount)
  if (newBalance < 0) {
    throw new InvariantViolationError(
      `取り崩し額（${amount}）が現在残高（${account.balance.currentBalance}）を超えている`,
    )
  }
  return appendManualEntry(replaceOtherSavingsBalance(account, newBalance, params.at), {
    kind: 'manual_withdrawal',
    enteredByUserId: params.operatorUserId,
    amount,
    enteredAt: params.at,
    ...memo,
  })
}

/**
 * behavior 別銀行貯蓄残高を手動補正する（08d §2）
 * 事前: 入力者ユーザーID = 口座所有者ユーザーID。
 * 補正は差分ではなく「実際の残高」への差し替え（通帳を見て入れ直す操作）。
 *
 * 不変条件: 補正後の残高は負にならない。
 *
 * 事後: 残高補正手入力（入力者・補正前残高・補正後残高・入力日時・メモ）が操作記録に
 * 1 件積まれる（#459）。補正前と同じ額での補正も記録する — 通帳と突き合わせて
 * 「合っていることを確かめた」操作自体が、残高鮮度の根拠として意味を持つため。
 */
export function correctOtherSavingsBalance(
  account: OtherSavingsAccount,
  params: { correctedBalance: Money; operatorUserId: UserId; at: Date; memo?: string },
): OtherSavingsAccount {
  assertOperatedByOwner(account, params.operatorUserId, '残高の補正')
  assertActive(account, '残高の補正')
  const correctedBalance = parseBalanceInput(params.correctedBalance, '別銀行貯蓄残高')
  const memo = parseMemo(params.memo)
  return appendManualEntry(replaceOtherSavingsBalance(account, correctedBalance, params.at), {
    kind: 'manual_correction',
    enteredByUserId: params.operatorUserId,
    balanceBefore: account.balance.currentBalance,
    balanceAfter: correctedBalance,
    enteredAt: params.at,
    ...memo,
  })
}

/**
 * behavior NISA積立累計をSMBC振込で加算する（08d §2）
 * 事前: 出金用途 = NISA積立用 / 振込先証券会社が出金変動から特定済み（いずれも呼び出し側の責務）。
 *
 * 積立は買い付けの累計であり減算されない（時価評価は追わない設計 — 08d §1）。
 * そのため加算のみを提供し、金額は 1 円以上に限る。
 */
export function addNisaContributionBySmbcTransfer(
  account: NisaAccount,
  params: { amount: Money; at: Date },
): NisaAccount {
  assertActive(account, '振込による積立累計の加算')
  const amount = PositiveMoneySchema.parse(params.amount)
  return AccountSchema.parse({
    ...account,
    contribution: {
      ...account.contribution,
      currentAccumulated: addMoney(account.contribution.currentAccumulated, amount),
      lastUpdatedAt: params.at,
    },
  }) as NisaAccount
}

/**
 * NISA 口座の積立累計を差し替える（本ファイル内の共通処理）。
 * 別銀行貯蓄の `replaceOtherSavingsBalance` に相当するが、NISA は残高鮮度の根拠を
 * 供給しない（08d §1 の残高鮮度根拠は別銀行貯蓄口座のみが持つ）ため、進めるのは
 * 積立累計の最終更新日時だけ。
 */
function replaceNisaAccumulated(
  account: NisaAccount,
  newAccumulated: Money,
  at: Date,
): NisaAccount {
  return AccountSchema.parse({
    ...account,
    contribution: {
      ...account.contribution,
      currentAccumulated: newAccumulated,
      lastUpdatedAt: at,
    },
  }) as NisaAccount
}

/**
 * NISA 口座の手入力の操作記録を 1 件積む（#458）。追記のみで、既存の記録は書き換えない。
 * 別銀行貯蓄の `appendManualEntry` と対になる。
 */
function appendNisaManualEntry(account: NisaAccount, entry: NisaManualEntry): NisaAccount {
  return AccountSchema.parse({
    ...account,
    contribution: {
      ...account.contribution,
      manualEntries: [...account.contribution.manualEntries, entry],
    },
  }) as NisaAccount
}

/**
 * behavior NISA積立累計を手動補正する（08d §2、#458）
 * 事前: 入力者ユーザーID = 口座所有者ユーザーID。
 * 補正は差分ではなく「実際の積立累計」への差し替え（証券会社の画面を見て入れ直す操作）。
 *
 * 積立累計は買い付けの累計で減算されない（08d §1）ため、通常の経路は加算だけになる。
 * 二重に加算した・桁を打ち間違えたときに正しい値へ戻す手段がこれで、無いと初期累計
 * （「始めた時点でいくら積み立てていたか」の記録）を歪めて辻褄を合わせるしかなくなる。
 *
 * 不変条件: 補正後の積立累計は負にならない。
 *
 * 事後: 積立累計補正手入力（入力者・補正前後の累計・入力日時・メモ）が操作記録に 1 件積まれる。
 * 補正前と同じ額での補正も記録する（別銀行貯蓄の残高補正と同じ扱い）。
 * 拒否された補正（負の累計・非アクティブ・他人の口座）は記録に残らない。
 *
 * 初期累計・初期累計基準時刻は動かさない。そこは「始めた時点」の記録で、現在の累計を
 * 直す操作とは別（初期累計そのものの誤りは `correctInitialBalance` で直す）。
 *
 * その結果、補正後の積立累計が初期累計を下回る状態も作れる（通常の積み上げ〔現在累計 =
 * 初期累計 + 以降の加算〕では生じない状態）。これは意図した挙動で、下回る補正を拒むと
 * 「初期累計を誤って大きく入れた」ケースの復旧が塞がるため（そこを直す `correctInitialBalance`
 * は差分で現在累計もずらすので、先に現在累計を実際の値へ寄せておけない）。
 * 「実際にいくら積み立てたか」を正とし、初期累計との整合は利用者の入力に委ねる。
 */
export function correctNisaContribution(
  account: NisaAccount,
  params: { correctedAccumulated: Money; operatorUserId: UserId; at: Date; memo?: string },
): NisaAccount {
  assertOperatedByOwner(account, params.operatorUserId, '積立累計の補正')
  assertActive(account, '積立累計の補正')
  const correctedAccumulated = parseBalanceInput(params.correctedAccumulated, 'NISA積立累計')
  const memo = parseMemo(params.memo)
  return appendNisaManualEntry(
    replaceNisaAccumulated(account, correctedAccumulated, params.at),
    NisaManualEntrySchema.parse({
      kind: 'manual_correction',
      enteredByUserId: params.operatorUserId,
      accumulatedBefore: account.contribution.currentAccumulated,
      accumulatedAfter: correctedAccumulated,
      enteredAt: params.at,
      ...memo,
    }),
  )
}

/**
 * behavior 初期残高を後から修正する（08d §2）
 * 事前: 修正者ユーザーID = 口座所有者ユーザーID。
 *
 * 初期残高は現在残高の起点（現在残高 = 初期残高 + 以降の変動）であり、オンボーディング
 * Phase 2-B の入力ミスを直す操作。したがって現在残高も同じ差分だけずらす（初期値だけ
 * 直して現在残高を据え置くと、以降の変動を積み上げた現在残高が誤ったままになる）。
 * 初期残高基準時刻は「いつ時点の残高か」の記録なので巻き直さない（論点9）。
 *
 * 三井住友カードは残高ではなく未払金集約が正のため対象外（InvariantViolationError）。
 * 別銀行貯蓄・NISA は修正後の現在残高が負にならないことを課す。SMBC 残高には課さない
 * （applySmbcBalanceChange と同じ扱い。冒頭の不変条件コメント参照）。
 *
 * 旧初期残高を口座と一緒に返す。初期残高修正イベント（08d §3）は旧新の両方を必要とし、
 * 呼び出し側が種別ごとに旧値を取り出すと「カードには初期残高が無い」分岐が外へ漏れるため。
 */
export function correctInitialBalance(
  account: Account,
  params: { initialBalance: Money; operatorUserId: UserId; at: Date },
): { account: Account; oldInitialBalance: Money } {
  assertOperatedByOwner(account, params.operatorUserId, '初期残高の修正')
  assertActive(account, '初期残高の修正')
  const initialBalance = parseBalanceInput(params.initialBalance, '初期残高')
  switch (account.kind) {
    case 'mitsui_sumitomo_card':
      throw new InvariantViolationError(
        '三井住友カードは初期残高を持たない（未払金は三井住友カード未払金集約が保持する）',
      )
    case 'smbc_bank': {
      const oldInitialBalance = account.balance.initialBalance
      const delta = subtractMoney(initialBalance, oldInitialBalance)
      return {
        oldInitialBalance,
        account: AccountSchema.parse({
          ...account,
          balance: {
            ...account.balance,
            initialBalance,
            currentBalance: addMoney(account.balance.currentBalance, delta),
            lastUpdatedAt: params.at,
          },
        }),
      }
    }
    case 'other_savings': {
      const oldInitialBalance = account.balance.initialBalance
      const delta = subtractMoney(initialBalance, oldInitialBalance)
      const newBalance = addMoney(account.balance.currentBalance, delta)
      if (newBalance < 0) {
        throw new InvariantViolationError(
          `初期残高を ${initialBalance} に修正すると現在残高が負（${newBalance}）になる`,
        )
      }
      return {
        oldInitialBalance,
        account: replaceOtherSavingsBalance(
          AccountSchema.parse({
            ...account,
            balance: { ...account.balance, initialBalance },
          }) as OtherSavingsAccount,
          newBalance,
          params.at,
        ),
      }
    }
    case 'nisa': {
      const oldInitialBalance = account.contribution.initialAccumulated
      const delta = subtractMoney(initialBalance, oldInitialBalance)
      const newAccumulated = addMoney(account.contribution.currentAccumulated, delta)
      if (newAccumulated < 0) {
        throw new InvariantViolationError(
          `初期累計を ${initialBalance} に修正すると積立累計が負（${newAccumulated}）になる`,
        )
      }
      return {
        oldInitialBalance,
        account: AccountSchema.parse({
          ...account,
          contribution: {
            ...account.contribution,
            initialAccumulated: initialBalance,
            currentAccumulated: newAccumulated,
            lastUpdatedAt: params.at,
          },
        }),
      }
    }
  }
}

/**
 * behavior 口座を非アクティブ化する（08d §2）
 * 事前: 操作者ユーザーID = 口座所有者ユーザーID（他の手動操作と同じ。残高一覧・資産合計から
 * 口座が外れる影響を配偶者が起こせないようにする）。
 * 事後: 以降この口座への残高変動は適用されない（09-aggregates #9）。
 *
 * 対象は別銀行貯蓄・NISA のみ。三井住友系（SMBC 銀行・カード）は取込基盤が管理する口座で、
 * 閉じるとメール由来の残高更新・引落消込の反映が毎回 InvariantViolationError で落ち続け、
 * 「未払金は消込済み・残高は未反映」の状態から回復できなくなる（#388 の回復経路が塞がる）。
 * 三井住友系も登録はできる（#395）が、閉じられるかどうかは別の判断で、閉じた後の回復手段が
 * 無いこの制限は残す。
 *
 * 既に非アクティブな口座の再実行は InvariantViolationError。非アクティブ化日時と理由は
 * 「いつ・なぜ閉じたか」の記録であり、上書きすると最初に閉じた事実が失われる。
 *
 * 押し間違えたときは reactivateAccount で元に戻せる（#457）。
 */
export function inactivateAccount(
  account: Account,
  params: { reason: string; operatorUserId: UserId; at: Date },
): Account {
  assertOperatedByOwner(account, params.operatorUserId, '口座の非アクティブ化')
  if (account.kind === 'smbc_bank' || account.kind === 'mitsui_sumitomo_card') {
    throw new InvariantViolationError(
      `非アクティブ化できるのは別銀行貯蓄・NISA 口座のみ（現種別: ${account.kind}）`,
    )
  }
  if (account.common.activeness.kind === 'inactive') {
    throw new InvariantViolationError(
      `口座（${account.common.accountId}）は既に非アクティブ化されている`,
    )
  }
  const reason = InactivationReasonSchema.parse(params.reason)
  return AccountSchema.parse({
    ...account,
    common: {
      ...account.common,
      activeness: { kind: 'inactive', inactivatedAt: params.at, reason },
    },
  })
}

/**
 * behavior 口座を再アクティブ化する（08d §2。#457）
 * 事前: 操作者ユーザーID = 口座所有者ユーザーID（非アクティブ化と同じ。配偶者が
 * 相手の口座を勝手に残高一覧・資産合計へ戻せないようにする）。
 * 事前: 口座が非アクティブ（アクティブな口座への再実行は InvariantViolationError）。
 * 事後: 口座が残高一覧・世帯資産合計に戻り、以降の残高変動が再び適用される（09-aggregates #9）。
 *
 * 非アクティブ化を押し間違えたときの復旧手段。これが無いと「同一ユーザー × 口座種別は一意」の
 * 制約により同種別の登録し直しもできず、残高が資産合計から消えたままデータベースの直接操作で
 * しか戻せなかった。
 *
 * 口座種別では絞らない（非アクティブ化は別銀行貯蓄・NISA のみだが、こちらは制限しない）。
 * 戻す操作を種別で拒むと、何らかの理由で非アクティブになった三井住友系の口座が閉じたまま
 * 取り残され、復旧手段が無くなるため。
 *
 * 解除する非アクティブ記録（日時・理由）を同時に返す（`correctInitialBalance` が旧初期残高を
 * 返すのと同じ形）。口座側の「いつ・なぜ閉じたか」はアクティブに戻す時点で消えるため、
 * 呼び出し側が口座再アクティブ化イベントやログへ引き継げるようにする。
 *
 * 残高・最終更新日時・残高鮮度根拠は動かさない。閉じている間に残高は変わっておらず、
 * 戻した時点で「最近確認した」ことにすると鮮度の警告をすり抜けるため。
 */
export function reactivateAccount(
  account: Account,
  params: { operatorUserId: UserId },
): { account: Account; clearedInactivation: { inactivatedAt: Date; reason: string } } {
  assertOperatedByOwner(account, params.operatorUserId, '口座の再アクティブ化')
  const activeness = account.common.activeness
  if (activeness.kind === 'active') {
    throw new InvariantViolationError(`口座（${account.common.accountId}）は既にアクティブである`)
  }
  return {
    account: AccountSchema.parse({
      ...account,
      common: { ...account.common, activeness: { kind: 'active' } },
    }),
    clearedInactivation: { inactivatedAt: activeness.inactivatedAt, reason: activeness.reason },
  }
}
