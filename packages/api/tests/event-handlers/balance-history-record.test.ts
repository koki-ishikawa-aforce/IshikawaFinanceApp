/**
 * 残高の変動 → 残高変動履歴への記録（#398）
 *
 * 資産の推移グラフが読む正を作る唯一の書き込み口。残高が動く経路すべてから
 * 点が 1 つずつ残ること、同じ変動が二度届いても点が重ならないことを検証する。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  AccountBalanceUpdatedSchema,
  AccountIdSchema,
  AccountSchema,
  BrokerageNameSchema,
  InitialBalanceCorrectedSchema,
  InitialBalanceRegisteredSchema,
  MitsuiSumitomoUnpaidIdSchema,
  MitsuiSumitomoUnpaidSchema,
  NisaContributionAddedSchema,
  OtherSavingsBalanceUpdatedSchema,
  SettlementNoticeIdSchema,
  TransactionIdSchema,
  UnpaidBookkeptSchema,
  UnpaidEntryIdSchema,
  UnpaidSettledSchema,
  UserIdSchema,
  money,
  registerNisaAccount,
  registerOtherSavingsAccount,
} from '@warimaru/domain'
import type {
  Account,
  BalanceHistoryEntry,
  MitsuiSumitomoUnpaid,
  NisaAccount,
  OtherSavingsAccount,
  SmbcBankAccount,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { createTestApp } from '../helpers/test-app.js'
import { domainEventBase } from '../../src/event-handlers/event-base.js'

const OWNER_USER_ID = UserIdSchema.parse('user-honey-test')
const AT = new Date('2026-07-10T00:00:00Z')
/** 期間読み出しの窓。2026-07（JST）を丸ごと含む */
const FROM = new Date('2026-06-30T15:00:00Z')
const TO = new Date('2026-07-31T15:00:00Z')

function smbcAccount(): SmbcBankAccount {
  return AccountSchema.parse({
    kind: 'smbc_bank',
    common: {
      accountId: AccountIdSchema.parse(newUlid()),
      ownerUserId: OWNER_USER_ID,
      registeredAt: AT,
      activeness: { kind: 'active' },
    },
    balance: {
      currentBalance: money(100000),
      initialBalance: money(100000),
      initialBalanceBaselineAt: AT,
      lastUpdatedAt: AT,
    },
  }) as SmbcBankAccount
}

function savingsAccount(): OtherSavingsAccount {
  return registerOtherSavingsAccount({
    accountId: AccountIdSchema.parse(newUlid()),
    ownerUserId: OWNER_USER_ID,
    bankName: 'ゆうちょ銀行' as OtherSavingsAccount['bankName'],
    initialBalance: money(800000),
    at: AT,
  })
}

function nisaAccount(): NisaAccount {
  return registerNisaAccount({
    accountId: AccountIdSchema.parse(newUlid()),
    ownerUserId: OWNER_USER_ID,
    brokerageName: BrokerageNameSchema.parse({ kind: 'sbi' }),
    initialAccumulated: money(300000),
    at: AT,
  })
}

function cardAccount(unpaidAggregateRef: string): Account {
  return AccountSchema.parse({
    kind: 'mitsui_sumitomo_card',
    common: {
      accountId: AccountIdSchema.parse(newUlid()),
      ownerUserId: OWNER_USER_ID,
      registeredAt: AT,
      activeness: { kind: 'active' },
    },
    unpaidAggregateRef,
  })
}

function unpaidAggregate(accountId: string, bookedAmount: number): MitsuiSumitomoUnpaid {
  return MitsuiSumitomoUnpaidSchema.parse({
    unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema.parse(newUlid()),
    accountId: AccountIdSchema.parse(accountId),
    currentMonthUnpaidTotal: bookedAmount,
    entries:
      bookedAmount === 0
        ? []
        : [
            {
              kind: 'booked',
              entryId: UnpaidEntryIdSchema.parse(newUlid()),
              transactionId: TransactionIdSchema.parse(newUlid()),
              bookedAt: AT,
              amount: bookedAmount,
            },
          ],
    lastSettledAt: null,
  })
}

async function historyOf(t: ReturnType<typeof createTestApp>): Promise<BalanceHistoryEntry[]> {
  return t.deps.balanceHistoryRepository.findByOccurredAtRange(FROM, TO)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('残高の変動 → 残高変動履歴への記録（#398）', () => {
  it('SMBC 残高の更新は SMBC 軸に、変動後の残高で 1 点残す', async () => {
    const t = createTestApp()
    const account = smbcAccount()
    await t.deps.accountRepository.save(account)

    await t.deps.eventBus.publish(
      AccountBalanceUpdatedSchema.parse({
        ...domainEventBase(AT),
        type: 'AccountBalanceUpdated',
        accountId: account.common.accountId,
        delta: money(-42000),
        newBalance: money(58000),
      }),
    )

    const entries = await historyOf(t)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      axis: 'smbc_balance',
      accountId: account.common.accountId,
      balance: 58000,
    })
    expect(entries[0]?.occurredAt).toEqual(AT)
  })

  it('同じ AccountBalanceUpdated でも、口座が別銀行貯蓄なら別銀行貯蓄の軸に残す', async () => {
    // 資金移動のシャドウ残高反映は SMBC と同じイベント型を使う。軸はイベント型ではなく
    // 口座種別で決まる — ここを取り違えると 2 本の線が混ざる
    const t = createTestApp()
    const account = savingsAccount()
    await t.deps.accountRepository.save(account)

    await t.deps.eventBus.publish(
      AccountBalanceUpdatedSchema.parse({
        ...domainEventBase(AT),
        type: 'AccountBalanceUpdated',
        accountId: account.common.accountId,
        delta: money(50000),
        newBalance: money(850000),
      }),
    )

    const entries = await historyOf(t)
    expect(entries.map(e => e.axis)).toEqual(['other_savings_balance'])
    expect(entries[0]?.balance).toBe(850000)
  })

  it('手入力（取り崩し・残高補正）は別銀行貯蓄の軸に残す', async () => {
    const t = createTestApp()
    const account = savingsAccount()
    await t.deps.accountRepository.save(account)

    await t.deps.eventBus.publish(
      OtherSavingsBalanceUpdatedSchema.parse({
        ...domainEventBase(AT),
        type: 'OtherSavingsBalanceUpdated',
        accountId: account.common.accountId,
        delta: money(-30000),
        newBalance: money(770000),
        source: 'manual_withdrawal',
      }),
    )

    const entries = await historyOf(t)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ axis: 'other_savings_balance', balance: 770000 })
  })

  it('NISA 積立の加算は積立累計の軸に、加算後の累計で残す', async () => {
    const t = createTestApp()
    const account = nisaAccount()
    await t.deps.accountRepository.save(account)

    await t.deps.eventBus.publish(
      NisaContributionAddedSchema.parse({
        ...domainEventBase(AT),
        type: 'NisaContributionAdded',
        accountId: account.common.accountId,
        addedAmount: money(50000),
        newAccumulated: money(350000),
        brokerageName: BrokerageNameSchema.parse({ kind: 'sbi' }),
      }),
    )

    const entries = await historyOf(t)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ axis: 'nisa_contribution', balance: 350000 })
  })

  it('口座登録時の初期残高がグラフの起点として残る', async () => {
    const t = createTestApp()
    const account = savingsAccount()
    await t.deps.accountRepository.save(account)

    await t.deps.eventBus.publish(
      InitialBalanceRegisteredSchema.parse({
        ...domainEventBase(AT),
        type: 'InitialBalanceRegistered',
        userId: OWNER_USER_ID,
        accountId: account.common.accountId,
        initialBalance: money(800000),
      }),
    )

    const entries = await historyOf(t)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ axis: 'other_savings_balance', balance: 800000 })
  })

  it('初期残高の後修正は、修正後の現在残高を残す（初期残高そのものではない）', async () => {
    const t = createTestApp()
    // 初期残高 800000 → 900000 に修正済み（現在残高も +100000 されている）状態の口座
    const corrected = savingsAccount()
    const account = AccountSchema.parse({
      ...corrected,
      balance: {
        ...corrected.balance,
        initialBalance: money(900000),
        currentBalance: money(950000),
      },
    })
    await t.deps.accountRepository.save(account)

    await t.deps.eventBus.publish(
      InitialBalanceCorrectedSchema.parse({
        ...domainEventBase(AT),
        type: 'InitialBalanceCorrected',
        accountId: account.common.accountId,
        oldInitialBalance: money(800000),
        newInitialBalance: money(900000),
        correctedByUserId: OWNER_USER_ID,
      }),
    )

    const entries = await historyOf(t)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.balance).toBe(950000)
  })

  it('カード利用の計上は未払い合計の軸に、集約が持つ合計で残す', async () => {
    const t = createTestApp()
    const unpaidId = MitsuiSumitomoUnpaidIdSchema.parse(newUlid())
    const card = cardAccount(unpaidId)
    await t.deps.accountRepository.save(card)
    const unpaid = MitsuiSumitomoUnpaidSchema.parse({
      ...unpaidAggregate(card.common.accountId, 42000),
      unpaidAggregateId: unpaidId,
    })
    await t.deps.mitsuiSumitomoUnpaidRepository.save(unpaid)

    await t.deps.eventBus.publish(
      UnpaidBookkeptSchema.parse({
        ...domainEventBase(AT),
        type: 'UnpaidBookkept',
        unpaidAggregateId: unpaidId,
        entryId: UnpaidEntryIdSchema.parse(newUlid()),
        transactionId: TransactionIdSchema.parse(newUlid()),
        bookedAmount: money(42000),
      }),
    )

    const entries = await historyOf(t)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      axis: 'card_unpaid',
      accountId: card.common.accountId,
      balance: 42000,
    })
  })

  it('引落の消込は未払い合計が 0 になった点を残す', async () => {
    const t = createTestApp()
    const unpaidId = MitsuiSumitomoUnpaidIdSchema.parse(newUlid())
    const card = cardAccount(unpaidId)
    await t.deps.accountRepository.save(card)
    await t.deps.mitsuiSumitomoUnpaidRepository.save(
      MitsuiSumitomoUnpaidSchema.parse({
        ...unpaidAggregate(card.common.accountId, 0),
        unpaidAggregateId: unpaidId,
      }),
    )

    await t.deps.eventBus.publish(
      UnpaidSettledSchema.parse({
        ...domainEventBase(AT),
        type: 'UnpaidSettled',
        unpaidAggregateId: unpaidId,
        settledEntryIds: [UnpaidEntryIdSchema.parse(newUlid())],
        settlementNoticeId: SettlementNoticeIdSchema.parse('sn-001'),
        settledTotal: money(42000),
      }),
    )

    const entries = await historyOf(t)
    expect(entries.map(e => e.axis)).toEqual(['card_unpaid'])
    expect(entries[0]?.balance).toBe(0)
  })

  it('同一イベントの再配信では点が重ならない（冪等）', async () => {
    const t = createTestApp()
    const account = smbcAccount()
    await t.deps.accountRepository.save(account)
    const event = AccountBalanceUpdatedSchema.parse({
      ...domainEventBase(AT),
      type: 'AccountBalanceUpdated',
      accountId: account.common.accountId,
      delta: money(-42000),
      newBalance: money(58000),
    })

    await t.deps.eventBus.publish(event)
    await t.deps.eventBus.publish(event)

    expect(await historyOf(t)).toHaveLength(1)
  })

  it('別々の変動は、同じ額でも別の点として残る', async () => {
    const t = createTestApp()
    const account = smbcAccount()
    await t.deps.accountRepository.save(account)
    const publish = async (occurredAt: Date) =>
      t.deps.eventBus.publish(
        AccountBalanceUpdatedSchema.parse({
          ...domainEventBase(occurredAt),
          type: 'AccountBalanceUpdated',
          accountId: account.common.accountId,
          delta: money(-1000),
          newBalance: money(58000),
        }),
      )

    await publish(new Date('2026-07-10T00:00:00Z'))
    await publish(new Date('2026-07-11T00:00:00Z'))

    expect(await historyOf(t)).toHaveLength(2)
  })

  it('口座が見つからないと記録できず、失敗をログに残す（主処理は落とさない）', async () => {
    const t = createTestApp()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      t.deps.eventBus.publish(
        AccountBalanceUpdatedSchema.parse({
          ...domainEventBase(AT),
          type: 'AccountBalanceUpdated',
          accountId: AccountIdSchema.parse(newUlid()),
          delta: money(-1),
          newBalance: money(1),
        }),
      ),
    ).resolves.toBeUndefined()

    expect(await historyOf(t)).toHaveLength(0)
    expect(errorLog).toHaveBeenCalled()
  })
})
