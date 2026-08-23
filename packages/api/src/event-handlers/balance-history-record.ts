/**
 * イベントチェーン: 残高の変動 → 残高変動履歴への記録（#398）
 *
 * 資産の推移グラフが読む正は残高変動履歴（08d）で、その唯一の書き込み口が本ハンドラー。
 * 残高が動く経路すべてが最後にドメインイベントを発行するので、経路ごとに記録処理を
 * 散らさず、イベントの購読 1 か所に集める（記録の取りこぼしがそのままグラフの欠損になる）。
 *
 * 購読するイベントと対応する軸:
 * - AccountBalanceUpdated      … 口座種別から軸を決める（SMBC 残高 / 別銀行貯蓄残高）。
 *                                 引落消込の残高反映・資金移動のシャドウ残高反映が発行する
 * - OtherSavingsBalanceUpdated … 別銀行貯蓄残高（取り崩し・残高補正の手入力）
 * - NisaContributionAdded      … NISA 積立累計（振込由来の加算）
 * - NisaContributionCorrected  … NISA 積立累計（手入力の補正。#458）
 * - InitialBalanceRegistered   … 口座登録時の初期残高（グラフの起点）
 * - InitialBalanceCorrected    … 初期残高の後修正（現在残高も同じ差分ずれる）
 * - UnpaidBookkept             … カード未払い合計（カード利用の計上）
 * - UnpaidSettled              … カード未払い合計（引落の消込。消込後は 0）
 *
 * 冪等性: (残高軸, 由来イベントID) の一意制約に置く（Repository.append）。イベント配信は
 * at-least-once（#34）で、同じイベントが二度届いてもグラフに点は重ならない。
 * 自動反映の経路は、ドメイン集約の二重適用ガードを通過したときだけイベントを発行する
 * （bookUnpaid / settleUnpaid / applyUnpaidSettlementToSmbcBalance / applyOtherSavingsMovement）
 * ため、同じ変動が別のイベントIDで再発行されることは無い。手入力の経路（取り崩し・残高補正・
 * 積立累計の補正・初期残高の修正）にはガードが無いが、そちらは再送信のたびに残高そのものも動くので、
 * 新しいイベントIDで新しい点が積まれるのが正しい。
 *
 * 回復について（重要）: 追記に失敗した点は**あとから自動では埋まらない**。上記のガードにより
 * 同じ変動のイベントは二度と発行されないため、safeSubscribe が想定する「同一操作の再実行で
 * 回復する」経路がこのハンドラーには無い（次に同じ軸が動けば絶対値が記録されるので線自体は
 * 復帰するが、欠けた点は戻らない）。したがって失敗は握りつぶさず、どの点が欠けたかを
 * 復元できる情報（軸・口座ID・発生日時・由来イベントID。金額は載せない）をログに残す。
 */
import {
  BalanceHistoryEntryIdSchema,
  InvariantViolationError,
  balanceAxisOfAccountKind,
  recordBalanceChange,
} from '@warimaru/domain'
import type {
  AccountBalanceUpdated,
  AccountId,
  AccountRepository,
  BalanceAxis,
  BalanceHistoryRepository,
  EventBus,
  InitialBalanceCorrected,
  InitialBalanceRegistered,
  MitsuiSumitomoUnpaidRepository,
  Money,
  NisaContributionAdded,
  NisaContributionCorrected,
  OtherSavingsBalanceUpdated,
  UnpaidBookkept,
  UnpaidSettled,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { safeSubscribe } from './safe-subscribe.js'

export interface BalanceHistoryRecordHandlerDeps {
  accountRepository: AccountRepository
  mitsuiSumitomoUnpaidRepository: MitsuiSumitomoUnpaidRepository
  balanceHistoryRepository: BalanceHistoryRepository
}

export function registerBalanceHistoryRecordEventHandlers(
  eventBus: EventBus,
  deps: BalanceHistoryRecordHandlerDeps,
): void {
  async function append(params: {
    axis: BalanceAxis
    accountId: AccountId
    value: Money
    occurredAt: Date
    sourceEventId: string
  }): Promise<void> {
    try {
      await deps.balanceHistoryRepository.append(
        recordBalanceChange({
          entryId: BalanceHistoryEntryIdSchema.parse(newUlid()),
          ...params,
        }),
      )
    } catch (e) {
      // 欠けた点を手で入れ直せるよう、値以外の識別情報を残してから投げ直す
      console.error(
        `残高変動履歴への追記に失敗した（axis=${params.axis} accountId=${params.accountId} ` +
          `occurredAt=${params.occurredAt.toISOString()} sourceEventId=${params.sourceEventId}）`,
      )
      throw e
    }
  }

  /**
   * 口座の現在の値（SMBC・別銀行貯蓄は残高、NISA は積立累計）と軸を取り出す。
   * イベントが運ぶのは口座IDだけなので、軸の判定には口座の種別が要る。
   * カード口座は残高を持たない（未払金集約が正）ため対象外。
   */
  async function resolveAccountAxisAndValue(
    accountId: AccountId,
  ): Promise<{ axis: BalanceAxis; value: Money }> {
    const account = await deps.accountRepository.findById(accountId)
    if (account === null) {
      throw new InvariantViolationError(`口座が見つからない: ${accountId}`)
    }
    const axis = balanceAxisOfAccountKind(account.kind)
    switch (account.kind) {
      case 'smbc_bank':
      case 'other_savings':
        return { axis, value: account.balance.currentBalance }
      case 'nisa':
        return { axis, value: account.contribution.currentAccumulated }
      case 'mitsui_sumitomo_card':
        throw new InvariantViolationError(
          `カード口座（${accountId}）の未払い合計は未払金集約が正のため、口座からは記録できない`,
        )
    }
  }

  // 引落消込の残高反映（SMBC）／資金移動のシャドウ残高反映（別銀行貯蓄）。
  // 変動後の値はイベントが運ぶ newBalance をそのまま使い、軸だけ口座から決める
  safeSubscribe<AccountBalanceUpdated>(eventBus, 'AccountBalanceUpdated', async event => {
    const { axis } = await resolveAccountAxisAndValue(event.accountId)
    await append({
      axis,
      accountId: event.accountId,
      value: event.newBalance,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  // 取り崩しの記録・残高補正（手入力）
  safeSubscribe<OtherSavingsBalanceUpdated>(eventBus, 'OtherSavingsBalanceUpdated', async event => {
    await append({
      axis: 'other_savings_balance',
      accountId: event.accountId,
      value: event.newBalance,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  safeSubscribe<NisaContributionAdded>(eventBus, 'NisaContributionAdded', async event => {
    await append({
      axis: 'nisa_contribution',
      accountId: event.accountId,
      value: event.newAccumulated,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  // 積立累計の手動補正（#458）。補正後の累計をそのまま点として積む
  safeSubscribe<NisaContributionCorrected>(eventBus, 'NisaContributionCorrected', async event => {
    await append({
      axis: 'nisa_contribution',
      accountId: event.accountId,
      value: event.newAccumulated,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  // 口座登録時の初期残高。グラフの起点になる 1 点目で、これが無いと最初の変動まで線が始まらない
  safeSubscribe<InitialBalanceRegistered>(eventBus, 'InitialBalanceRegistered', async event => {
    const { axis } = await resolveAccountAxisAndValue(event.accountId)
    await append({
      axis,
      accountId: event.accountId,
      value: event.initialBalance,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  // 初期残高の後修正。現在残高も同じ差分ずれるため、修正後の現在残高を口座から読み直す
  // （イベントが運ぶのは初期残高の旧新のみで、現在残高は載っていない）
  safeSubscribe<InitialBalanceCorrected>(eventBus, 'InitialBalanceCorrected', async event => {
    const { axis, value } = await resolveAccountAxisAndValue(event.accountId)
    await append({
      axis,
      accountId: event.accountId,
      value,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  /**
   * カード未払い合計を未払金集約から読み直して記録する。
   * 計上・消込のイベントは変動額しか運ばないため、合計は集約が正（08d §1）。
   */
  async function appendCardUnpaid(params: {
    unpaidAggregateId: UnpaidBookkept['unpaidAggregateId']
    occurredAt: Date
    sourceEventId: string
  }): Promise<void> {
    const unpaid = await deps.mitsuiSumitomoUnpaidRepository.findById(params.unpaidAggregateId)
    if (unpaid === null) {
      throw new InvariantViolationError(`未払金集約が見つからない: ${params.unpaidAggregateId}`)
    }
    await append({
      axis: 'card_unpaid',
      accountId: unpaid.accountId,
      value: unpaid.currentMonthUnpaidTotal,
      occurredAt: params.occurredAt,
      sourceEventId: params.sourceEventId,
    })
  }

  safeSubscribe<UnpaidBookkept>(eventBus, 'UnpaidBookkept', async event => {
    await appendCardUnpaid({
      unpaidAggregateId: event.unpaidAggregateId,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  safeSubscribe<UnpaidSettled>(eventBus, 'UnpaidSettled', async event => {
    await appendCardUnpaid({
      unpaidAggregateId: event.unpaidAggregateId,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })
}
