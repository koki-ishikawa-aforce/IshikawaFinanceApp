/**
 * 冪等ガードがエラーメッセージの文言に依存していないことの検証（#388）
 *
 * 以前は `String(e.message).includes('計上済み')` のように日本語の文言との部分一致で
 * 「適用済みスキップ」を判定していた。文言を言い換えるとガードは黙って効かなくなり、
 * 静かなスキップが例外に変わる（例外は safeSubscribe に吸収され、ログにしか残らない）。
 * この破損は通常のテストでは検出できない — 「二重計上されないこと」を見るテストは、
 * ガードが壊れて例外になった場合も二重計上は起きないため緑のまま通るためである。
 *
 * そこでドメイン関数が**別の文言**で専用エラー型を投げるようにモックし、
 * ハンドラーが型だけで判定していることを振る舞いで示す。文言一致に戻すと、
 * スキップされずに例外が safeSubscribe へ抜けるため、このファイルは赤になる。
 *
 * 併せて「専用型**以外**の例外は握りつぶさない」ことも検証する。ここが緩むと
 * （catch で無条件 return するなど）本来ログに出るべき異常が完全に無音になる。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 実装が参照しうる文言（'計上済み' / '消込適用済み' / '反映済み'）を一切含まない文言
const REWORDED_BOOK = 'this transaction was recorded earlier'
const REWORDED_SETTLE = 'this settlement notice was handled earlier'
const REWORDED_BALANCE = 'this settlement notice hit the balance earlier'

type GuardMode = 'passthrough' | 'reworded-guard' | 'other-invariant'

const control = vi.hoisted(() => ({
  book: 'passthrough' as GuardMode,
  settle: 'passthrough' as GuardMode,
  applyBalance: 'passthrough' as GuardMode,
}))

vi.mock('@warimaru/domain', async importOriginal => {
  const actual = await importOriginal<typeof import('@warimaru/domain')>()
  return {
    ...actual,
    bookUnpaid: (...args: Parameters<typeof actual.bookUnpaid>) => {
      if (control.book === 'reworded-guard')
        throw new actual.UnpaidAlreadyBookedError(REWORDED_BOOK)
      if (control.book === 'other-invariant') {
        throw new actual.InvariantViolationError('未払金集約が壊れている（別の不変条件違反）')
      }
      return actual.bookUnpaid(...args)
    },
    settleUnpaid: (...args: Parameters<typeof actual.settleUnpaid>) => {
      if (control.settle === 'reworded-guard') {
        throw new actual.UnpaidSettlementAlreadyAppliedError(REWORDED_SETTLE)
      }
      if (control.settle === 'other-invariant') {
        throw new actual.InvariantViolationError('計上中エントリが存在しないため消込できない')
      }
      return actual.settleUnpaid(...args)
    },
    applyUnpaidSettlementToSmbcBalance: (
      ...args: Parameters<typeof actual.applyUnpaidSettlementToSmbcBalance>
    ) => {
      if (control.applyBalance === 'reworded-guard') {
        throw new actual.UnpaidSettlementAlreadyAppliedError(REWORDED_BALANCE)
      }
      if (control.applyBalance === 'other-invariant') {
        throw new actual.InvariantViolationError('非アクティブ口座へ残高変動は適用できない')
      }
      return actual.applyUnpaidSettlementToSmbcBalance(...args)
    },
  }
})

const {
  AccountIdSchema,
  AccountSchema,
  CardUsageTransactionImportedSchema,
  MitsuiSumitomoUnpaidIdSchema,
  MitsuiSumitomoUnpaidSchema,
  SettlementNoticeIdSchema,
  SettlementNoticeReceivedSchema,
  TransactionIdSchema,
  UnpaidEntryIdSchema,
  UserIdSchema,
  money,
} = await import('@warimaru/domain')
type AccountBalanceUpdated = import('@warimaru/domain').AccountBalanceUpdated
type UnpaidBookkept = import('@warimaru/domain').UnpaidBookkept
type SmbcBankAccount = import('@warimaru/domain').SmbcBankAccount

const { newUlid } = await import('@warimaru/adapters-postgres')
const { createTestApp } = await import('../helpers/test-app.js')
const { domainEventBase } = await import('../../src/event-handlers/event-base.js')

type TestApp = ReturnType<typeof createTestApp>

const OWNER_USER_ID = UserIdSchema.parse('user-honey-test')
const SETTLEMENT_NOTICE_ID = SettlementNoticeIdSchema.parse('sn-2026-07-25-reworded')

function smbcBankAccount(accountId: string): SmbcBankAccount {
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

let errorLog: unknown[][]

beforeEach(() => {
  control.book = 'passthrough'
  control.settle = 'passthrough'
  control.applyBalance = 'passthrough'
  errorLog = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errorLog.push(args)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** 未払金集約（計上中エントリなし） */
async function seedEmptyUnpaid(app: TestApp) {
  const unpaid = MitsuiSumitomoUnpaidSchema.parse({
    unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema.parse(newUlid()),
    accountId: AccountIdSchema.parse(newUlid()),
    currentMonthUnpaidTotal: 0,
    entries: [],
    lastSettledAt: null,
  })
  await app.deps.mitsuiSumitomoUnpaidRepository.save(unpaid)
  return unpaid
}

/** 消込済み・残高未反映の集約（1回目の実行が残高反映の直前で失敗した状態） */
async function seedSettledUnpaid(app: TestApp, accountId: string) {
  const settledEntry = {
    kind: 'settled' as const,
    entryId: UnpaidEntryIdSchema.parse(newUlid()),
    transactionId: TransactionIdSchema.parse(newUlid()),
    bookedAt: new Date('2026-07-10T10:00:00Z'),
    settledAt: new Date('2026-07-25T10:00:00Z'),
    amount: money(8000),
    settlementNoticeId: SETTLEMENT_NOTICE_ID,
  }
  const unpaid = MitsuiSumitomoUnpaidSchema.parse({
    unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema.parse(newUlid()),
    accountId: AccountIdSchema.parse(accountId),
    currentMonthUnpaidTotal: 0,
    entries: [settledEntry],
    lastSettledAt: settledEntry.settledAt,
  })
  await app.deps.mitsuiSumitomoUnpaidRepository.save(unpaid)
  await app.deps.accountRepository.save(smbcBankAccount(accountId))
  return unpaid
}

/** 計上中エントリ1件を持つ集約（消込が成功する状態） */
async function seedBookedUnpaid(app: TestApp, accountId: string) {
  const unpaid = MitsuiSumitomoUnpaidSchema.parse({
    unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema.parse(newUlid()),
    accountId: AccountIdSchema.parse(accountId),
    currentMonthUnpaidTotal: 8000,
    entries: [
      {
        kind: 'booked' as const,
        entryId: UnpaidEntryIdSchema.parse(newUlid()),
        transactionId: TransactionIdSchema.parse(newUlid()),
        bookedAt: new Date('2026-07-10T10:00:00Z'),
        amount: money(8000),
      },
    ],
    lastSettledAt: null,
  })
  await app.deps.mitsuiSumitomoUnpaidRepository.save(unpaid)
  await app.deps.accountRepository.save(smbcBankAccount(accountId))
  return unpaid
}

function cardUsageEvent(unpaidAggregateId: string, accountId: string) {
  return CardUsageTransactionImportedSchema.parse({
    ...domainEventBase(),
    type: 'CardUsageTransactionImported',
    unpaidAggregateId,
    accountId,
    transactionId: TransactionIdSchema.parse(newUlid()),
    amount: money(5000),
  })
}

function settlementEvent(unpaidAggregateId: string, accountId: string) {
  return SettlementNoticeReceivedSchema.parse({
    ...domainEventBase(),
    type: 'SettlementNoticeReceived',
    unpaidAggregateId,
    accountId: AccountIdSchema.parse(accountId),
    settlementNoticeId: SETTLEMENT_NOTICE_ID,
  })
}

describe('冪等ガードはエラー文言に依存しない（#388）', () => {
  it('計上済みエラーの文言が変わっても、二重計上はスキップされる（例外にならない）', async () => {
    const t = createTestApp()
    const unpaid = await seedEmptyUnpaid(t)
    control.book = 'reworded-guard'

    const bookkeptLog: UnpaidBookkept[] = []
    t.deps.eventBus.subscribe<UnpaidBookkept>('UnpaidBookkept', e => {
      bookkeptLog.push(e)
    })

    await t.deps.eventBus.publish(cardUsageEvent(unpaid.unpaidAggregateId, unpaid.accountId))

    expect(bookkeptLog).toHaveLength(0)
    expect(errorLog).toHaveLength(0)
  })

  it('消込適用済みエラーの文言が変わっても、残高反映まで到達して回復する', async () => {
    const accountId = newUlid()
    const t = createTestApp()
    const unpaid = await seedSettledUnpaid(t, accountId)
    control.settle = 'reworded-guard'

    await t.deps.eventBus.publish(settlementEvent(unpaid.unpaidAggregateId, accountId))

    const account = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (account?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(account.balance.currentBalance).toBe(92000)
    expect(account.balance.appliedSettlementNoticeIds).toEqual([SETTLEMENT_NOTICE_ID])
    expect(errorLog).toHaveLength(0)
  })

  it('残高反映済みエラーの文言が変わっても、二重減算はスキップされる（例外にならない）', async () => {
    const accountId = newUlid()
    const t = createTestApp()
    // 消込も残高反映も済んだ通知の再送 = 正常な冪等スキップ（無言で終わる経路）
    const unpaid = await seedSettledUnpaid(t, accountId)
    control.applyBalance = 'reworded-guard'

    const balanceLog: AccountBalanceUpdated[] = []
    t.deps.eventBus.subscribe<AccountBalanceUpdated>('AccountBalanceUpdated', e => {
      balanceLog.push(e)
    })

    await t.deps.eventBus.publish(settlementEvent(unpaid.unpaidAggregateId, accountId))

    const account = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (account?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(account.balance.currentBalance).toBe(100000)
    expect(balanceLog).toHaveLength(0)
    expect(errorLog).toHaveLength(0)
  })

  it('消込は新規なのに残高が反映済みの場合は、集約間の不整合としてログに残る', async () => {
    // 正常な冪等スキップと同じ無言 return にすると、2集約の記録の食い違いが永久に不可視になる
    const accountId = newUlid()
    const t = createTestApp()
    const unpaid = await seedBookedUnpaid(t, accountId)
    control.applyBalance = 'reworded-guard'

    const balanceLog: AccountBalanceUpdated[] = []
    t.deps.eventBus.subscribe<AccountBalanceUpdated>('AccountBalanceUpdated', e => {
      balanceLog.push(e)
    })

    await t.deps.eventBus.publish(settlementEvent(unpaid.unpaidAggregateId, accountId))

    expect(balanceLog).toHaveLength(0)
    expect(errorLog).toHaveLength(1)
  })
})

describe('専用型以外の不変条件違反は握りつぶさない（#388）', () => {
  it('計上時の別の不変条件違反はスキップされず、ログに残る', async () => {
    const t = createTestApp()
    const unpaid = await seedEmptyUnpaid(t)
    control.book = 'other-invariant'

    const bookkeptLog: UnpaidBookkept[] = []
    t.deps.eventBus.subscribe<UnpaidBookkept>('UnpaidBookkept', e => {
      bookkeptLog.push(e)
    })

    await t.deps.eventBus.publish(cardUsageEvent(unpaid.unpaidAggregateId, unpaid.accountId))

    expect(bookkeptLog).toHaveLength(0)
    expect(errorLog).toHaveLength(1)
  })

  it('消込時の別の不変条件違反はスキップされず、残高にも触れない', async () => {
    const accountId = newUlid()
    const t = createTestApp()
    const unpaid = await seedSettledUnpaid(t, accountId)
    control.settle = 'other-invariant'

    await t.deps.eventBus.publish(settlementEvent(unpaid.unpaidAggregateId, accountId))

    const account = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (account?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(account.balance.currentBalance).toBe(100000)
    expect(errorLog).toHaveLength(1)
  })

  it('残高反映時の別の不変条件違反（非アクティブ口座など）はスキップされず、ログに残る', async () => {
    const accountId = newUlid()
    const t = createTestApp()
    const unpaid = await seedBookedUnpaid(t, accountId)
    control.applyBalance = 'other-invariant'

    const balanceLog: AccountBalanceUpdated[] = []
    t.deps.eventBus.subscribe<AccountBalanceUpdated>('AccountBalanceUpdated', e => {
      balanceLog.push(e)
    })

    await t.deps.eventBus.publish(settlementEvent(unpaid.unpaidAggregateId, accountId))

    expect(balanceLog).toHaveLength(0)
    expect(errorLog).toHaveLength(1)
  })
})
