import { describe, it, expect } from 'vitest'
import {
  AccountIdSchema,
  CardUsageTransactionImportedSchema,
  MitsuiSumitomoUnpaidIdSchema,
  MitsuiSumitomoUnpaidSchema,
  SettlementNoticeIdSchema,
  SettlementNoticeReceivedSchema,
  TransactionIdSchema,
  UnpaidEntryIdSchema,
  UserIdSchema,
  AccountSchema,
  money,
} from '@warimaru/domain'
import type {
  AccountBalanceUpdated,
  CardUsageTransactionImported,
  MitsuiSumitomoUnpaid,
  SettlementNoticeReceived,
  SmbcBankAccount,
  UnpaidBookkept,
  UnpaidSettled,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import { createTestApp } from '../helpers/test-app.js'
import { domainEventBase } from '../../src/event-handlers/event-base.js'

const OWNER_USER_ID = UserIdSchema.parse('user-honey-test')

function makeUnpaidAggregate(unpaidAggregateId?: string, accountId?: string): MitsuiSumitomoUnpaid {
  return MitsuiSumitomoUnpaidSchema.parse({
    unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema.parse(unpaidAggregateId ?? newUlid()),
    accountId: AccountIdSchema.parse(accountId ?? newUlid()),
    currentMonthUnpaidTotal: 0,
    entries: [],
    lastSettledAt: null,
  })
}

function makeSmbcBankAccount(accountId: string): SmbcBankAccount {
  const now = new Date('2026-07-01T00:00:00Z')
  return AccountSchema.parse({
    kind: 'smbc_bank',
    common: {
      accountId: AccountIdSchema.parse(accountId),
      ownerUserId: OWNER_USER_ID,
      registeredAt: now,
      activeness: { kind: 'active' },
    },
    balance: {
      currentBalance: money(100000),
      initialBalance: money(100000),
      initialBalanceBaselineAt: now,
      lastUpdatedAt: now,
    },
  }) as SmbcBankAccount
}

describe('カード利用取込 → 未払金計上（イベントチェーン3 bookUnpaid #69）', () => {
  it('正常系: CardUsageTransactionImported で未払金エントリが計上され UnpaidBookkept が発火する', async () => {
    const t = createTestApp()
    const unpaid = makeUnpaidAggregate()
    await t.deps.mitsuiSumitomoUnpaidRepository.save(unpaid)

    const bookkeptLog: UnpaidBookkept[] = []
    t.deps.eventBus.subscribe<UnpaidBookkept>('UnpaidBookkept', e => {
      bookkeptLog.push(e)
    })

    const event: CardUsageTransactionImported = CardUsageTransactionImportedSchema.parse({
      ...domainEventBase(),
      type: 'CardUsageTransactionImported',
      unpaidAggregateId: unpaid.unpaidAggregateId,
      accountId: unpaid.accountId,
      transactionId: TransactionIdSchema.parse(newUlid()),
      amount: money(5000),
    })
    await t.deps.eventBus.publish(event)

    const saved = await t.deps.mitsuiSumitomoUnpaidRepository.findById(unpaid.unpaidAggregateId)
    expect(saved).not.toBeNull()
    expect(saved!.currentMonthUnpaidTotal).toBe(5000)
    expect(saved!.entries).toHaveLength(1)
    expect(saved!.entries[0]!.kind).toBe('booked')
    expect(saved!.entries[0]!.transactionId).toBe(event.transactionId)

    expect(bookkeptLog).toHaveLength(1)
    expect(bookkeptLog[0]!.transactionId).toBe(event.transactionId)
    expect(bookkeptLog[0]!.bookedAmount).toBe(5000)
  })

  it('冪等: 同一 transactionId の二重計上はスキップされる', async () => {
    const t = createTestApp()
    const unpaid = makeUnpaidAggregate()
    await t.deps.mitsuiSumitomoUnpaidRepository.save(unpaid)

    const bookkeptLog: UnpaidBookkept[] = []
    t.deps.eventBus.subscribe<UnpaidBookkept>('UnpaidBookkept', e => {
      bookkeptLog.push(e)
    })

    const txId = TransactionIdSchema.parse(newUlid())
    const event: CardUsageTransactionImported = CardUsageTransactionImportedSchema.parse({
      ...domainEventBase(),
      type: 'CardUsageTransactionImported',
      unpaidAggregateId: unpaid.unpaidAggregateId,
      accountId: unpaid.accountId,
      transactionId: txId,
      amount: money(3000),
    })

    await t.deps.eventBus.publish(event)
    await t.deps.eventBus.publish(event)

    const saved = await t.deps.mitsuiSumitomoUnpaidRepository.findById(unpaid.unpaidAggregateId)
    expect(saved!.entries).toHaveLength(1)
    expect(saved!.currentMonthUnpaidTotal).toBe(3000)
    expect(bookkeptLog).toHaveLength(1)
  })
})

describe('引落確定通知 → 未払金消込・口座残高更新（イベントチェーン3 settle #69）', () => {
  it('正常系: SettlementNoticeReceived で消込され UnpaidSettled + AccountBalanceUpdated が発火する', async () => {
    const accountId = newUlid()
    const t = createTestApp()

    const unpaid = makeUnpaidAggregate(undefined, accountId)
    const bookedEntry = {
      kind: 'booked' as const,
      entryId: UnpaidEntryIdSchema.parse(newUlid()),
      transactionId: TransactionIdSchema.parse(newUlid()),
      bookedAt: new Date('2026-07-10T10:00:00Z'),
      amount: money(8000),
    }
    const unpaidWithEntry = MitsuiSumitomoUnpaidSchema.parse({
      ...unpaid,
      currentMonthUnpaidTotal: 8000,
      entries: [bookedEntry],
    })
    await t.deps.mitsuiSumitomoUnpaidRepository.save(unpaidWithEntry)

    const account = makeSmbcBankAccount(accountId)
    await t.deps.accountRepository.save(account)

    const settledLog: UnpaidSettled[] = []
    const balanceLog: AccountBalanceUpdated[] = []
    t.deps.eventBus.subscribe<UnpaidSettled>('UnpaidSettled', e => {
      settledLog.push(e)
    })
    t.deps.eventBus.subscribe<AccountBalanceUpdated>('AccountBalanceUpdated', e => {
      balanceLog.push(e)
    })

    const settlementNoticeId = SettlementNoticeIdSchema.parse('sn-2026-07-25-001')
    const event: SettlementNoticeReceived = SettlementNoticeReceivedSchema.parse({
      ...domainEventBase(),
      type: 'SettlementNoticeReceived',
      unpaidAggregateId: unpaidWithEntry.unpaidAggregateId,
      accountId: AccountIdSchema.parse(accountId),
      settlementNoticeId,
    })
    await t.deps.eventBus.publish(event)

    const savedUnpaid = await t.deps.mitsuiSumitomoUnpaidRepository.findById(
      unpaidWithEntry.unpaidAggregateId,
    )
    expect(savedUnpaid!.currentMonthUnpaidTotal).toBe(0)
    expect(savedUnpaid!.entries.every(e => e.kind === 'settled')).toBe(true)

    const savedAccount = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    expect(savedAccount!.kind).toBe('smbc_bank')
    if (savedAccount!.kind === 'smbc_bank') {
      expect(savedAccount!.balance.currentBalance).toBe(92000)
    }

    expect(settledLog).toHaveLength(1)
    expect(settledLog[0]!.settledTotal).toBe(8000)
    expect(settledLog[0]!.settlementNoticeId).toBe(settlementNoticeId)

    expect(balanceLog).toHaveLength(1)
    expect(balanceLog[0]!.delta).toBe(-8000)
    expect(balanceLog[0]!.newBalance).toBe(92000)
  })

  it('冪等: 同一 settlementNoticeId の重複消込はスキップされる', async () => {
    const accountId = newUlid()
    const t = createTestApp()

    const unpaid = makeUnpaidAggregate(undefined, accountId)
    const bookedEntry = {
      kind: 'booked' as const,
      entryId: UnpaidEntryIdSchema.parse(newUlid()),
      transactionId: TransactionIdSchema.parse(newUlid()),
      bookedAt: new Date('2026-07-10T10:00:00Z'),
      amount: money(5000),
    }
    const unpaidWithEntry = MitsuiSumitomoUnpaidSchema.parse({
      ...unpaid,
      currentMonthUnpaidTotal: 5000,
      entries: [bookedEntry],
    })
    await t.deps.mitsuiSumitomoUnpaidRepository.save(unpaidWithEntry)

    const account = makeSmbcBankAccount(accountId)
    await t.deps.accountRepository.save(account)

    const settledLog: UnpaidSettled[] = []
    t.deps.eventBus.subscribe<UnpaidSettled>('UnpaidSettled', e => {
      settledLog.push(e)
    })

    const settlementNoticeId = SettlementNoticeIdSchema.parse('sn-2026-07-25-dup')
    const event: SettlementNoticeReceived = SettlementNoticeReceivedSchema.parse({
      ...domainEventBase(),
      type: 'SettlementNoticeReceived',
      unpaidAggregateId: unpaidWithEntry.unpaidAggregateId,
      accountId: AccountIdSchema.parse(accountId),
      settlementNoticeId,
    })

    await t.deps.eventBus.publish(event)
    await t.deps.eventBus.publish(event)

    expect(settledLog).toHaveLength(1)

    const savedAccount = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (savedAccount!.kind === 'smbc_bank') {
      expect(savedAccount!.balance.currentBalance).toBe(95000)
    }
  })
})
