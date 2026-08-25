import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  AccountRepository,
  CardUsageTransactionImported,
  MitsuiSumitomoUnpaid,
  SettlementNoticeReceived,
  SmbcBankAccount,
  UnpaidBookkept,
  UnpaidSettled,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { createTestApp } from '../helpers/test-app.js'
import { createDeps } from '../../src/composition-root.js'
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

    const usedAt = new Date('2026-07-05T12:00:00Z')
    const event: CardUsageTransactionImported = CardUsageTransactionImportedSchema.parse({
      ...domainEventBase(usedAt),
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
    // #539: 発行される UnpaidBookkept の occurredAt は処理実行時刻ではなく、
    // トリガーイベント(実際にカードを使った日)をそのまま引き継ぐ
    expect(bookkeptLog[0]!.occurredAt).toEqual(usedAt)
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

    const settledAt = new Date('2026-07-26T09:00:00Z')
    const settlementNoticeId = SettlementNoticeIdSchema.parse('sn-2026-07-25-001')
    const event: SettlementNoticeReceived = SettlementNoticeReceivedSchema.parse({
      ...domainEventBase(settledAt),
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
    // #539: UnpaidSettled / AccountBalanceUpdated の occurredAt は処理実行時刻ではなく、
    // トリガーイベント(実際に引き落とされた日)をそのまま引き継ぐ
    expect(settledLog[0]!.occurredAt).toEqual(settledAt)
    expect(balanceLog[0]!.occurredAt).toEqual(settledAt)
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

// --- #388: 消込は済んだが残高が未反映のまま失敗した経路を、再実行で回復する ---

describe('引落確定通知の再実行による残高反映の回復（#388）', () => {
  /**
   * ハンドラーの例外は safeSubscribe が console.error へ落として握りつぶす。
   * 「冪等にスキップされた」と「毎回例外で死んでいる」はどちらも残高が動かないため、
   * ログの本数まで見ないと区別できない（テスト品質レビュー指摘）。
   */
  let errorLog: unknown[][]

  beforeEach(() => {
    errorLog = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLog.push(args)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * 消込済み・残高未反映の状態を作る: 口座への到達を1回だけ失敗させる。
   * 例外は safeSubscribe に吸収されるため、本番と同じく publish 自体は成功する。
   */
  function accountRepositoryFailingOnce(
    base: AccountRepository,
    failAt: 'findById' | 'save',
  ): { repository: AccountRepository; arm: () => void } {
    // 前準備（口座の初期保存）で誤って消費しないよう、arm() を呼ぶまで失敗しない
    let armed = false
    const failOnce = () => {
      if (!armed) return false
      armed = false
      return true
    }
    return {
      arm: () => {
        armed = true
      },
      repository: {
        findById: async id => {
          if (failAt === 'findById' && failOnce()) {
            throw new Error('一時的な障害（口座の読み出しに失敗）')
          }
          return base.findById(id)
        },
        findByOwner: async ownerId => base.findByOwner(ownerId),
        save: async account => {
          if (failAt === 'save' && failOnce()) {
            throw new Error('一時的な障害（口座の保存に失敗）')
          }
          return base.save(account)
        },
      },
    }
  }

  async function setupSettledScenario(
    bookedAmount: number,
    failAt: 'findById' | 'save' = 'findById',
  ) {
    const accountId = newUlid()
    const failing = accountRepositoryFailingOnce((await createDeps({})).accountRepository, failAt)
    const app = createTestApp({ accountRepository: failing.repository })

    const unpaid = makeUnpaidAggregate(undefined, accountId)
    const bookedEntry = {
      kind: 'booked' as const,
      entryId: UnpaidEntryIdSchema.parse(newUlid()),
      transactionId: TransactionIdSchema.parse(newUlid()),
      bookedAt: new Date('2026-07-10T10:00:00Z'),
      amount: money(bookedAmount),
    }
    const unpaidWithEntry = MitsuiSumitomoUnpaidSchema.parse({
      ...unpaid,
      currentMonthUnpaidTotal: bookedAmount,
      entries: [bookedEntry],
    })
    await app.deps.mitsuiSumitomoUnpaidRepository.save(unpaidWithEntry)
    await app.deps.accountRepository.save(makeSmbcBankAccount(accountId))
    failing.arm() // ここから先の1回だけ失敗する

    const event: SettlementNoticeReceived = SettlementNoticeReceivedSchema.parse({
      ...domainEventBase(),
      type: 'SettlementNoticeReceived',
      unpaidAggregateId: unpaidWithEntry.unpaidAggregateId,
      accountId: AccountIdSchema.parse(accountId),
      settlementNoticeId: SettlementNoticeIdSchema.parse('sn-2026-07-25-recovery'),
    })
    return { app, accountId, unpaidWithEntry, event }
  }

  it('口座保存の直前で失敗した後、同じイベントの再実行で残高がちょうど1回分減って回復する', async () => {
    const { app, accountId, unpaidWithEntry, event } = await setupSettledScenario(8000)

    // 1回目: 消込は保存されるが、口座の読み出しで失敗して残高が未反映のまま
    await app.deps.eventBus.publish(event)

    const afterFailure = await app.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (afterFailure?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(afterFailure.balance.currentBalance).toBe(100000)
    expect(afterFailure.balance.appliedSettlementNoticeIds).toEqual([])
    const settledUnpaid = await app.deps.mitsuiSumitomoUnpaidRepository.findById(
      unpaidWithEntry.unpaidAggregateId,
    )
    expect(settledUnpaid!.currentMonthUnpaidTotal).toBe(0)

    // 2回目（再実行）: 消込済みでも残高反映まで到達して回復する
    const balanceLog: AccountBalanceUpdated[] = []
    app.deps.eventBus.subscribe<AccountBalanceUpdated>('AccountBalanceUpdated', e => {
      balanceLog.push(e)
    })
    await app.deps.eventBus.publish(event)

    const recovered = await app.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (recovered?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(recovered.balance.currentBalance).toBe(92000)
    expect(recovered.balance.appliedSettlementNoticeIds).toEqual(['sn-2026-07-25-recovery'])
    expect(balanceLog).toHaveLength(1)
    expect(balanceLog[0]!.delta).toBe(-8000)
    // 回復の実行自体が例外で落ちていないこと（落ちても残高は減らないので、
    // 残高の検証だけでは「回復した」と「毎回死んでいる」を区別できない）
    expect(errorLog).toHaveLength(1) // 1件目の注入した障害のみ
  })

  it('回復後にさらに3回再実行しても残高は二重に減らない', async () => {
    const { app, accountId, event } = await setupSettledScenario(8000)

    await app.deps.eventBus.publish(event) // 失敗（残高未反映）
    await app.deps.eventBus.publish(event) // 回復

    const balanceLog: AccountBalanceUpdated[] = []
    app.deps.eventBus.subscribe<AccountBalanceUpdated>('AccountBalanceUpdated', e => {
      balanceLog.push(e)
    })
    await app.deps.eventBus.publish(event)
    await app.deps.eventBus.publish(event)
    await app.deps.eventBus.publish(event)

    const account = await app.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (account?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(account.balance.currentBalance).toBe(92000)
    expect(balanceLog).toHaveLength(0)
    // 3回の再実行が「冪等にスキップ」されたこと。例外で毎回死んでいても残高は
    // 動かないため、ログが増えていないことまで見ないと両者を区別できない
    expect(errorLog).toHaveLength(1) // 1件目の注入した障害のみ
  })

  it('再実行では UnpaidSettled を再発行しない（消込は1度きり）', async () => {
    const { app, event } = await setupSettledScenario(8000)

    const settledLog: UnpaidSettled[] = []
    app.deps.eventBus.subscribe<UnpaidSettled>('UnpaidSettled', e => {
      settledLog.push(e)
    })

    await app.deps.eventBus.publish(event) // 消込は成功・残高反映で失敗
    await app.deps.eventBus.publish(event) // 回復
    await app.deps.eventBus.publish(event)

    expect(settledLog).toHaveLength(1)
    expect(settledLog[0]!.settledTotal).toBe(8000)
    expect(errorLog).toHaveLength(1) // 1件目の注入した障害のみ
  })

  it('口座の保存自体が失敗した場合も、再実行で残高がちょうど1回分減って回復する', async () => {
    const { app, accountId, event } = await setupSettledScenario(8000, 'save')

    await app.deps.eventBus.publish(event)

    const afterFailure = await app.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (afterFailure?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(afterFailure.balance.currentBalance).toBe(100000)

    await app.deps.eventBus.publish(event)

    const recovered = await app.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (recovered?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(recovered.balance.currentBalance).toBe(92000)
    expect(recovered.balance.appliedSettlementNoticeIds).toEqual(['sn-2026-07-25-recovery'])
    // 注入した保存失敗の記録2件（ハンドラーが出す識別子付きの1行 + safeSubscribe の1行）。
    // 再実行側は無言で成功しているので、これ以上増えない
    expect(errorLog).toHaveLength(2)
  })

  it('別の通知を反映した後に古い通知が再送されても、残高は二重に減らない', async () => {
    // メール再取込で過去の引落確定通知が古い順に再発行される経路。口座側の記録が
    // 「最後の1件」だけだとここを素通りし、過去分がもう一度減算される
    const accountId = newUlid()
    const app = createTestApp()
    const account = makeSmbcBankAccount(accountId)
    await app.deps.accountRepository.save(account)

    async function settleWith(noticeId: string, amount: number, entrySeed: string) {
      const unpaid = makeUnpaidAggregate(entrySeed, accountId)
      const unpaidWithEntry = MitsuiSumitomoUnpaidSchema.parse({
        ...unpaid,
        currentMonthUnpaidTotal: amount,
        entries: [
          {
            kind: 'booked' as const,
            entryId: UnpaidEntryIdSchema.parse(newUlid()),
            transactionId: TransactionIdSchema.parse(newUlid()),
            bookedAt: new Date('2026-06-10T10:00:00Z'),
            amount: money(amount),
          },
        ],
      })
      await app.deps.mitsuiSumitomoUnpaidRepository.save(unpaidWithEntry)
      const event: SettlementNoticeReceived = SettlementNoticeReceivedSchema.parse({
        ...domainEventBase(),
        type: 'SettlementNoticeReceived',
        unpaidAggregateId: unpaidWithEntry.unpaidAggregateId,
        accountId: AccountIdSchema.parse(accountId),
        settlementNoticeId: SettlementNoticeIdSchema.parse(noticeId),
      })
      await app.deps.eventBus.publish(event)
      return event
    }

    const june = await settleWith('sn-2026-06-25', 8000, newUlid())
    await settleWith('sn-2026-07-25', 2000, newUlid())

    const beforeReplay = await app.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (beforeReplay?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(beforeReplay.balance.currentBalance).toBe(90000)

    // 6月分の通知を再送する
    await app.deps.eventBus.publish(june)

    const afterReplay = await app.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    if (afterReplay?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(afterReplay.balance.currentBalance).toBe(90000)
    expect(errorLog).toHaveLength(0)
  })
})
