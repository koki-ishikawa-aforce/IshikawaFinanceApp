import { describe, it, expect, beforeEach } from 'vitest'
import {
  AccountIdSchema,
  BankDepositIdSchema,
  ExpenseReimbursementIdSchema,
  TransactionIdSchema,
  UserIdSchema,
  determineBankDepositPurpose,
  determineBankDepositPurposeForUser,
  bankDepositPurposeRule,
  money,
  recordBankDeposit,
  registerOtherSavingsAccount,
} from '@warimaru/domain'
import type {
  AccountBalanceUpdated,
  BankDeposit,
  BankDepositPurposeDetermined,
  ExpenseReimbursementDepositArrived,
  ExpenseReimbursementDepositReceived,
  UserId,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const EMPLOYER = '振込サービス ｶ)ﾜﾘﾏﾙｼｮｳｼﾞ'
const SAVINGS_BANK = 'ﾖｿﾞﾗ銀行'

const rule = bankDepositPurposeRule({
  employerRemitterNames: [EMPLOYER],
  otherSavingsCounterpartyNames: [SAVINGS_BANK],
})

/** JST の指定日 12:00 */
function jstNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0))
}

/**
 * 判別ルールを通して入金を 1 件記録する。
 * 実運用では日次メール取込バッチ（#414 / #35）がこの経路を担う。
 */
async function seedDeposit(
  t: TestApp,
  params: { userId: UserId; amount: number; occurredAt: Date; remitterName: string },
): Promise<BankDeposit> {
  const purpose = determineBankDepositPurpose(
    {
      amount: money(params.amount),
      occurredAt: params.occurredAt,
      remitterName: params.remitterName,
    },
    rule,
  )
  const deposit = recordBankDeposit({
    common: {
      bankDepositId: BankDepositIdSchema.parse(newUlid()),
      accountId: AccountIdSchema.parse(newUlid()),
      transactionId: TransactionIdSchema.parse(newUlid()),
      userId: params.userId,
      amount: money(params.amount),
      occurredAt: params.occurredAt,
      remitterName: params.remitterName,
      determinedAt: params.occurredAt,
    },
    purpose,
    expenseReimbursementId: ExpenseReimbursementIdSchema.parse(newUlid()),
  })
  await t.deps.bankDepositRepository.save(deposit)
  return deposit
}

/** 手動確認待ちに落ちる入金（上中旬 かつ 25 万円以上 = 2 シグナル矛盾） */
const AMBIGUOUS = { amount: 300_000, occurredAt: jstNoon(2026, 7, 10), remitterName: EMPLOYER }

interface AwaitingWire {
  deposits: {
    bankDepositId: string
    amount: number
    occurredAt: string
    remitterName: string
    employerRemitterRegistered: boolean
  }[]
}

describe('GET /api/bank-deposits/awaiting', () => {
  let t: TestApp

  beforeEach(() => {
    t = createTestApp()
  })

  it('自動確定できなかった入金が手動確認待ちとして返る', async () => {
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    const res = await request(t.app, 'GET', '/api/bank-deposits/awaiting')
    expect(res.status).toBe(200)
    const body = await json<AwaitingWire>(res)
    expect(body.deposits).toHaveLength(1)
    expect(body.deposits[0]).toEqual({
      bankDepositId: deposit.common.bankDepositId,
      amount: 300_000,
      // 入金日は用途を判断する主要な手がかりなので応答に必ず載る
      occurredAt: AMBIGUOUS.occurredAt.toISOString(),
      remitterName: EMPLOYER,
      // まだ勤務先として覚えていないので「今後も勤務先として扱う」を出してよい（#448）
      employerRemitterRegistered: false,
    })
  })

  it('自動確定できた入金は手動確認待ちに現れない', async () => {
    // 月末 かつ 25 万円以上 = 2 シグナル一致 → 給与判別として自動確定
    await seedDeposit(t, {
      userId: VIEWER_ID,
      amount: 300_000,
      occurredAt: jstNoon(2026, 7, 31),
      remitterName: EMPLOYER,
    })

    const res = await request(t.app, 'GET', '/api/bank-deposits/awaiting')
    expect((await json<AwaitingWire>(res)).deposits).toHaveLength(0)
  })

  it('否定形: 配偶者の手動確認待ち入金は見えない（プライバシー3段階ルール）', async () => {
    await seedDeposit(t, { userId: SPOUSE_ID, ...AMBIGUOUS })

    const res = await request(t.app, 'GET', '/api/bank-deposits/awaiting', { viewerId: VIEWER_ID })
    expect(res.status).toBe(200)
    expect((await json<AwaitingWire>(res)).deposits).toHaveLength(0)
  })

  it('発生順（古い入金が先）で返る', async () => {
    const older = await seedDeposit(t, {
      userId: VIEWER_ID,
      ...AMBIGUOUS,
      occurredAt: jstNoon(2026, 6, 10),
    })
    const newer = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    const body = await json<AwaitingWire>(
      await request(t.app, 'GET', '/api/bank-deposits/awaiting'),
    )
    expect(body.deposits.map(d => d.bankDepositId)).toEqual([
      older.common.bankDepositId,
      newer.common.bankDepositId,
    ])
  })
})

describe('POST /api/bank-deposits/:id/purpose', () => {
  let t: TestApp

  beforeEach(() => {
    t = createTestApp()
  })

  it('本人が用途を確定すると手動確認待ちから消える', async () => {
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    const res = await request(
      t.app,
      'POST',
      `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`,
      { body: { purpose: 'salary' } },
    )
    expect(res.status).toBe(200)
    expect(await json<{ purpose: string }>(res)).toMatchObject({ purpose: 'salary' })

    const awaiting = await json<AwaitingWire>(
      await request(t.app, 'GET', '/api/bank-deposits/awaiting'),
    )
    expect(awaiting.deposits).toHaveLength(0)
  })

  it('確定すると入金用途判別イベントが手動確定として発行される', async () => {
    const events: BankDepositPurposeDetermined[] = []
    t.deps.eventBus.subscribe<BankDepositPurposeDetermined>(
      'BankDepositPurposeDetermined',
      e => void events.push(e),
    )
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    await request(t.app, 'POST', `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`, {
      body: { purpose: 'salary' },
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      purpose: 'salary',
      determinationSource: 'manual',
      amount: 300_000,
      userId: VIEWER_ID,
    })
  })

  it('経費精算入金として確定すると経費精算へ入金到着イベントが発火する', async () => {
    const received: ExpenseReimbursementDepositReceived[] = []
    t.deps.eventBus.subscribe<ExpenseReimbursementDepositReceived>(
      'ExpenseReimbursementDepositReceived',
      e => void received.push(e),
    )
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    await request(t.app, 'POST', `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`, {
      body: { purpose: 'expense_reimbursement' },
    })

    expect(received).toHaveLength(1)
    expect(received[0]?.depositAmount).toBe(300_000)
  })

  it('経費精算入金ID が 集約・判別イベント・到着イベント で同一になる（突合対象が増殖しない）', async () => {
    const arrived: ExpenseReimbursementDepositArrived[] = []
    const determined: BankDepositPurposeDetermined[] = []
    t.deps.eventBus.subscribe<ExpenseReimbursementDepositArrived>(
      'ExpenseReimbursementDepositArrived',
      e => void arrived.push(e),
    )
    t.deps.eventBus.subscribe<BankDepositPurposeDetermined>(
      'BankDepositPurposeDetermined',
      e => void determined.push(e),
    )
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    await request(t.app, 'POST', `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`, {
      body: { purpose: 'expense_reimbursement' },
    })

    const stored = await t.deps.bankDepositRepository.findById(deposit.common.bankDepositId)
    const storedId =
      stored?.kind === 'expense_reimbursement' ? stored.expenseReimbursementId : undefined
    expect(storedId).toBeDefined()
    expect(arrived[0]?.expenseReimbursementId).toBe(storedId)
    expect(determined[0]?.expenseReimbursementId).toBe(storedId)
  })

  it('経費精算入金の確定で突合待ちの経費精算入金が作られる（08e の突合が起動する）', async () => {
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    await request(t.app, 'POST', `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`, {
      body: { purpose: 'expense_reimbursement' },
    })

    const awaiting =
      await t.deps.expenseReimbursementDepositRepository.findAwaitingByUser(VIEWER_ID)
    expect(awaiting).toHaveLength(1)
    expect(awaiting[0]?.common.depositAmount).toBe(300_000)
    expect(awaiting[0]?.common.depositedAt).toEqual(AMBIGUOUS.occurredAt)
  })

  it('同じ用途で確定し直しても突合待ちの経費精算入金は増えない', async () => {
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })
    const path = `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`
    const body = { body: { purpose: 'expense_reimbursement' } }

    await request(t.app, 'POST', path, body)
    await request(t.app, 'POST', path, body)

    expect(
      await t.deps.expenseReimbursementDepositRepository.findAwaitingByUser(VIEWER_ID),
    ).toHaveLength(1)
  })

  it.each(['salary', 'expense_reimbursement'] as const)(
    '%s で確定してもシャドウ残高は動かない（SMBC 側は取引取込で加算済み）',
    async purpose => {
      const accountId = AccountIdSchema.parse(newUlid())
      await t.deps.accountRepository.save(
        registerOtherSavingsAccount({
          accountId,
          ownerUserId: VIEWER_ID,
          bankName: '楽天銀行' as never,
          initialBalance: money(500_000),
          at: new Date('2026-07-01T00:00:00Z'),
        }),
      )
      const balanceEvents: AccountBalanceUpdated[] = []
      t.deps.eventBus.subscribe<AccountBalanceUpdated>(
        'AccountBalanceUpdated',
        e => void balanceEvents.push(e),
      )
      const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

      const res = await request(
        t.app,
        'POST',
        `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`,
        { body: { purpose } },
      )
      expect(res.status).toBe(200)

      const account = await t.deps.accountRepository.findById(accountId)
      expect(account?.kind === 'other_savings' && account.balance.currentBalance).toBe(500_000)
      expect(balanceEvents).toHaveLength(0)
    },
  )

  it('給与として確定したときは経費精算へは何も伝わらない', async () => {
    const received: ExpenseReimbursementDepositReceived[] = []
    t.deps.eventBus.subscribe<ExpenseReimbursementDepositReceived>(
      'ExpenseReimbursementDepositReceived',
      e => void received.push(e),
    )
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    await request(t.app, 'POST', `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`, {
      body: { purpose: 'salary' },
    })

    expect(received).toHaveLength(0)
  })

  describe('別銀行戻しとして確定したとき（シャドウ残高の反映）', () => {
    async function registerSavings(userId: UserId, initialBalance: number): Promise<string> {
      const accountId = AccountIdSchema.parse(newUlid())
      await t.deps.accountRepository.save(
        registerOtherSavingsAccount({
          accountId,
          ownerUserId: userId,
          bankName: '楽天銀行' as never,
          initialBalance: money(initialBalance),
          at: new Date('2026-07-01T00:00:00Z'),
        }),
      )
      return accountId
    }

    it('別銀行貯蓄残高（シャドウ）が入金額だけ減る', async () => {
      const accountId = await registerSavings(VIEWER_ID, 500_000)
      const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

      const res = await request(
        t.app,
        'POST',
        `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`,
        { body: { purpose: 'other_savings_return' } },
      )
      expect(res.status).toBe(200)

      const account = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
      expect(account?.kind).toBe('other_savings')
      expect(account?.kind === 'other_savings' && account.balance.currentBalance).toBe(200_000)
    })

    it('口座残高更新イベントが減算として発行される', async () => {
      await registerSavings(VIEWER_ID, 500_000)
      const events: AccountBalanceUpdated[] = []
      t.deps.eventBus.subscribe<AccountBalanceUpdated>(
        'AccountBalanceUpdated',
        e => void events.push(e),
      )
      const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

      await request(t.app, 'POST', `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`, {
        body: { purpose: 'other_savings_return' },
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ delta: -300_000, newBalance: 200_000 })
    })

    it('別銀行貯蓄口座が未登録なら失敗する（SMBC 側だけ増えた状態を黙認しない）', async () => {
      const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

      const res = await request(
        t.app,
        'POST',
        `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`,
        { body: { purpose: 'other_savings_return' } },
      )
      expect(res.status).toBe(409)

      // 確定は保存されるが未反映。同じ用途での再確定が回復の入口になる
      const stored = await t.deps.bankDepositRepository.findById(deposit.common.bankDepositId)
      expect(stored?.kind).toBe('other_savings_return')
    })

    it('口座を登録してから同じ用途で確定し直すと反映まで回復する', async () => {
      const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })
      const path = `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`
      const body = { body: { purpose: 'other_savings_return' } }

      expect((await request(t.app, 'POST', path, body)).status).toBe(409)

      const accountId = await registerSavings(VIEWER_ID, 500_000)
      expect((await request(t.app, 'POST', path, body)).status).toBe(200)

      const account = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
      expect(account?.kind === 'other_savings' && account.balance.currentBalance).toBe(200_000)
    })

    it('同じ用途で二度確定してもシャドウ残高は一度しか減らない', async () => {
      const accountId = await registerSavings(VIEWER_ID, 500_000)
      const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })
      const path = `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`
      const body = { body: { purpose: 'other_savings_return' } }

      expect((await request(t.app, 'POST', path, body)).status).toBe(200)
      expect((await request(t.app, 'POST', path, body)).status).toBe(200)

      const account = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
      expect(account?.kind === 'other_savings' && account.balance.currentBalance).toBe(200_000)
    })
  })

  describe('否定形・入力検証', () => {
    it('配偶者は他人の入金の用途を確定できない（プライバシー3段階ルール）', async () => {
      const deposit = await seedDeposit(t, { userId: SPOUSE_ID, ...AMBIGUOUS })

      const res = await request(
        t.app,
        'POST',
        `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`,
        { body: { purpose: 'salary' }, viewerId: VIEWER_ID },
      )
      expect(res.status).toBe(403)

      // 配偶者の入金は手動確認待ちのまま残る
      const stored = await t.deps.bankDepositRepository.findById(deposit.common.bankDepositId)
      expect(stored?.kind).toBe('unknown')
    })

    it('確定済みの入金は用途を変更できない（一方向遷移）', async () => {
      const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })
      const path = `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`
      await request(t.app, 'POST', path, { body: { purpose: 'salary' } })

      const res = await request(t.app, 'POST', path, { body: { purpose: 'expense_reimbursement' } })
      expect(res.status).toBe(409)

      const stored = await t.deps.bankDepositRepository.findById(deposit.common.bankDepositId)
      expect(stored?.kind).toBe('salary')
    })

    it('存在しない入金は 404', async () => {
      const res = await request(
        t.app,
        'POST',
        `/api/bank-deposits/${BankDepositIdSchema.parse(newUlid())}/purpose`,
        { body: { purpose: 'salary' } },
      )
      expect(res.status).toBe(404)
    })

    it('用途に「用途不明」は指定できない（確定にならない）', async () => {
      const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

      const res = await request(
        t.app,
        'POST',
        `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`,
        { body: { purpose: 'unknown' } },
      )
      expect(res.status).toBe(400)
    })

    it('認証されていないリクエストは受け付けない', async () => {
      const res = await t.app.request('/api/bank-deposits/awaiting')
      expect(res.status).toBe(401)
    })
  })
})

describe('確定と同時に勤務先の振込元名を覚える（#448 / OQ-61）', () => {
  let t: TestApp

  beforeEach(() => {
    t = createTestApp()
  })

  const path = (deposit: BankDeposit): string =>
    `/api/bank-deposits/${deposit.common.bankDepositId}/purpose`

  it('給与として確定しつつ登録すると、名簿にその振込元が載る', async () => {
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    const res = await request(t.app, 'POST', path(deposit), {
      body: { purpose: 'salary', registerRemitterAsEmployer: true },
    })
    expect(res.status).toBe(200)
    expect(await json<{ employerRemitterRegistered: boolean }>(res)).toMatchObject({
      employerRemitterRegistered: true,
    })

    const directory = await t.deps.employerRemitterDirectoryRepository.findByOwner(VIEWER_ID)
    expect(directory.entries).toHaveLength(1)
    expect(directory.entries[0]?.displayName).toBe(EMPLOYER)
  })

  it('登録を選ばなければ名簿は空のまま（既定では覚えない）', async () => {
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })

    await request(t.app, 'POST', path(deposit), { body: { purpose: 'salary' } })

    const directory = await t.deps.employerRemitterDirectoryRepository.findByOwner(VIEWER_ID)
    expect(directory.entries).toHaveLength(0)
  })

  it('覚えたあとの同じ振込元の入金は登録済みとして一覧に出る', async () => {
    const first = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })
    await request(t.app, 'POST', path(first), {
      body: { purpose: 'salary', registerRemitterAsEmployer: true },
    })
    await seedDeposit(t, {
      userId: VIEWER_ID,
      ...AMBIGUOUS,
      occurredAt: jstNoon(2026, 8, 10),
    })

    const body = await json<AwaitingWire>(
      await request(t.app, 'GET', '/api/bank-deposits/awaiting'),
    )
    expect(body.deposits).toHaveLength(1)
    expect(body.deposits[0]?.employerRemitterRegistered).toBe(true)
  })

  it('覚えた振込元は次の入金から自動確定に乗る（手動確認に落ちなくなる）', async () => {
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })
    await request(t.app, 'POST', path(deposit), {
      body: { purpose: 'salary', registerRemitterAsEmployer: true },
    })

    const directory = await t.deps.employerRemitterDirectoryRepository.findByOwner(VIEWER_ID)
    // 実運用ではこの判別を日次メール取込バッチ（#414 / #35）が行う
    const purpose = determineBankDepositPurposeForUser(
      {
        amount: money(300_000),
        occurredAt: jstNoon(2026, 8, 31),
        remitterName: EMPLOYER,
      },
      directory,
    )
    expect(purpose).toEqual({ kind: 'salary' })
  })

  it('同じ用途で確定し直しても登録は増えない（反映のやり直しで名簿が壊れない）', async () => {
    const deposit = await seedDeposit(t, { userId: VIEWER_ID, ...AMBIGUOUS })
    const body = { body: { purpose: 'salary', registerRemitterAsEmployer: true } }

    await request(t.app, 'POST', path(deposit), body)
    await request(t.app, 'POST', path(deposit), body)

    const directory = await t.deps.employerRemitterDirectoryRepository.findByOwner(VIEWER_ID)
    expect(directory.entries).toHaveLength(1)
  })

  it('否定形: 別銀行戻しの振込元は勤務先として覚えられない', async () => {
    const deposit = await seedDeposit(t, {
      userId: VIEWER_ID,
      amount: 300_000,
      occurredAt: jstNoon(2026, 7, 10),
      remitterName: SAVINGS_BANK,
    })

    const res = await request(t.app, 'POST', path(deposit), {
      body: { purpose: 'other_savings_return', registerRemitterAsEmployer: true },
    })
    expect(res.status).toBe(409)

    const directory = await t.deps.employerRemitterDirectoryRepository.findByOwner(VIEWER_ID)
    expect(directory.entries).toHaveLength(0)
  })

  it('否定形: 配偶者の入金からは自分の名簿に登録できない', async () => {
    const deposit = await seedDeposit(t, { userId: SPOUSE_ID, ...AMBIGUOUS })

    const res = await request(t.app, 'POST', path(deposit), {
      body: { purpose: 'salary', registerRemitterAsEmployer: true },
      viewerId: VIEWER_ID,
    })
    expect(res.status).toBe(403)

    const directory = await t.deps.employerRemitterDirectoryRepository.findByOwner(VIEWER_ID)
    expect(directory.entries).toHaveLength(0)
  })

  it('否定形: 配偶者が覚えた勤務先は自分の名簿には現れない（プライバシー3段階ルール）', async () => {
    const spouseDeposit = await seedDeposit(t, { userId: SPOUSE_ID, ...AMBIGUOUS })
    await request(t.app, 'POST', path(spouseDeposit), {
      body: { purpose: 'salary', registerRemitterAsEmployer: true },
      viewerId: SPOUSE_ID,
    })

    expect(
      (await t.deps.employerRemitterDirectoryRepository.findByOwner(SPOUSE_ID)).entries,
    ).toHaveLength(1)
    expect(
      (await t.deps.employerRemitterDirectoryRepository.findByOwner(VIEWER_ID)).entries,
    ).toHaveLength(0)
  })
})

describe('UserId の取り違え防止', () => {
  it('テストの viewer / spouse は別ユーザーである', () => {
    expect(UserIdSchema.parse(VIEWER_ID)).not.toBe(UserIdSchema.parse(SPOUSE_ID))
  })
})
