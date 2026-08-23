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
 * - NisaContributionAdded      … NISA 積立累計
 * - InitialBalanceRegistered   … 口座登録時の初期残高（グラフの起点）
 * - InitialBalanceCorrected    … 初期残高の後修正（現在残高も同じ差分ずれる）
 * - UnpaidBookkept             … カード未払い合計（カード利用の計上）
 * - UnpaidSettled              … カード未払い合計（引落の消込。消込後は 0）
 *
 * 冪等性: (残高軸, 由来イベントID) の一意制約に置く（Repository.append）。イベント配信は
 * at-least-once（#34）で、同じイベントが二度届いてもグラフに点は重ならない。
 * なお各経路の発行側は、ドメイン集約の二重適用ガードを通過したときだけイベントを発行する
 * （bookUnpaid / settleUnpaid / applyUnpaidSettlementToSmbcBalance / applyOtherSavingsMovement）。
 * したがって「同じ変動が別のイベントIDで再発行される」ことは無く、イベントIDを冪等キーに
 * できる。
 *
 * 記録できなかった変動はグラフから欠ける。safeSubscribe が例外を吸収して主処理
 * （残高そのものの更新）を守る一方、失敗は握りつぶさずログへ残す。
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
    balance: Money
    occurredAt: Date
    sourceEventId: string
  }): Promise<void> {
    await deps.balanceHistoryRepository.append(
      recordBalanceChange({
        entryId: BalanceHistoryEntryIdSchema.parse(newUlid()),
        ...params,
      }),
    )
  }

  /**
   * 口座の現在の値（SMBC・別銀行貯蓄は残高、NISA は積立累計）と軸を取り出す。
   * イベントが運ぶのは口座IDだけなので、軸の判定には口座の種別が要る。
   * カード口座は残高を持たない（未払金集約が正）ため対象外。
   */
  async function resolveAccountAxisAndBalance(
    accountId: AccountId,
  ): Promise<{ axis: BalanceAxis; balance: Money }> {
    const account = await deps.accountRepository.findById(accountId)
    if (account === null) {
      throw new InvariantViolationError(`口座が見つからない: ${accountId}`)
    }
    const axis = balanceAxisOfAccountKind(account.kind)
    switch (account.kind) {
      case 'smbc_bank':
      case 'other_savings':
        return { axis, balance: account.balance.currentBalance }
      case 'nisa':
        return { axis, balance: account.contribution.currentAccumulated }
      case 'mitsui_sumitomo_card':
        throw new InvariantViolationError(
          `カード口座（${accountId}）の未払い合計は未払金集約が正のため、口座からは記録できない`,
        )
    }
  }

  // 引落消込の残高反映（SMBC）／資金移動のシャドウ残高反映（別銀行貯蓄）。
  // 変動後の値はイベントが運ぶ newBalance をそのまま使い、軸だけ口座から決める
  safeSubscribe<AccountBalanceUpdated>(eventBus, 'AccountBalanceUpdated', async event => {
    const { axis } = await resolveAccountAxisAndBalance(event.accountId)
    await append({
      axis,
      accountId: event.accountId,
      balance: event.newBalance,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  // 取り崩しの記録・残高補正（手入力）
  safeSubscribe<OtherSavingsBalanceUpdated>(eventBus, 'OtherSavingsBalanceUpdated', async event => {
    await append({
      axis: 'other_savings_balance',
      accountId: event.accountId,
      balance: event.newBalance,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  safeSubscribe<NisaContributionAdded>(eventBus, 'NisaContributionAdded', async event => {
    await append({
      axis: 'nisa_contribution',
      accountId: event.accountId,
      balance: event.newAccumulated,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  // 口座登録時の初期残高。グラフの起点になる 1 点目で、これが無いと最初の変動まで線が始まらない
  safeSubscribe<InitialBalanceRegistered>(eventBus, 'InitialBalanceRegistered', async event => {
    const { axis } = await resolveAccountAxisAndBalance(event.accountId)
    await append({
      axis,
      accountId: event.accountId,
      balance: event.initialBalance,
      occurredAt: event.occurredAt,
      sourceEventId: event.eventId,
    })
  })

  // 初期残高の後修正。現在残高も同じ差分ずれるため、修正後の現在残高を口座から読み直す
  // （イベントが運ぶのは初期残高の旧新のみで、現在残高は載っていない）
  safeSubscribe<InitialBalanceCorrected>(eventBus, 'InitialBalanceCorrected', async event => {
    const { axis, balance } = await resolveAccountAxisAndBalance(event.accountId)
    await append({
      axis,
      accountId: event.accountId,
      balance,
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
      balance: unpaid.currentMonthUnpaidTotal,
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
