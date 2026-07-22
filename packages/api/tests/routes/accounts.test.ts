import { describe, it, expect } from 'vitest'
import type {
  AccountRegistered,
  BankNameChanged,
  BrokerageNameChanged,
  InitialBalanceRegistered,
} from '@warimaru/domain'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

interface AccountWire {
  kind: string
  common: { accountId: string; ownerUserId: string; activeness: { kind: string } }
  bankName?: string
  brokerageName?: { kind: string; customName?: string }
  balance?: { currentBalance: number; initialBalance: number }
  contribution?: { currentAccumulated: number; initialAccumulated: number }
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

interface EventLog {
  registered: AccountRegistered[]
  initialBalance: InitialBalanceRegistered[]
  bankNameChanged: BankNameChanged[]
  brokerageNameChanged: BrokerageNameChanged[]
}

function subscribeEvents(t: TestApp): EventLog {
  const log: EventLog = {
    registered: [],
    initialBalance: [],
    bankNameChanged: [],
    brokerageNameChanged: [],
  }
  t.deps.eventBus.subscribe<AccountRegistered>('AccountRegistered', e => {
    log.registered.push(e)
  })
  t.deps.eventBus.subscribe<InitialBalanceRegistered>('InitialBalanceRegistered', e => {
    log.initialBalance.push(e)
  })
  t.deps.eventBus.subscribe<BankNameChanged>('BankNameChanged', e => {
    log.bankNameChanged.push(e)
  })
  t.deps.eventBus.subscribe<BrokerageNameChanged>('BrokerageNameChanged', e => {
    log.brokerageNameChanged.push(e)
  })
  return log
}

async function registerOtherSavings(
  t: TestApp,
  options: { bankName?: string; viewerId?: typeof VIEWER_ID } = {},
): Promise<Response> {
  return request(t.app, 'POST', '/api/accounts', {
    viewerId: options.viewerId,
    body: {
      kind: 'other_savings',
      bankName: options.bankName ?? '楽天銀行',
      initialBalance: 500000,
    },
  })
}

async function registerNisa(t: TestApp): Promise<Response> {
  return request(t.app, 'POST', '/api/accounts', {
    body: { kind: 'nisa', brokerageName: { kind: 'sbi' }, initialAccumulated: 200000 },
  })
}

describe('POST /api/accounts', () => {
  it('別銀行貯蓄口座を登録できる（201、現在残高 = 初期残高）', async () => {
    const t = createTestApp()
    const res = await registerOtherSavings(t)
    expect(res.status).toBe(201)
    const { account } = await json<{ account: AccountWire }>(res)
    expect(account.kind).toBe('other_savings')
    expect(account.common.ownerUserId).toBe(VIEWER_ID)
    expect(account.common.activeness.kind).toBe('active')
    expect(account.bankName).toBe('楽天銀行')
    expect(account.balance?.currentBalance).toBe(500000)
    expect(account.balance?.initialBalance).toBe(500000)
  })

  it('登録で AccountRegistered と InitialBalanceRegistered を発行する（統合アクション）', async () => {
    const t = createTestApp()
    const log = subscribeEvents(t)
    const { account } = await json<{ account: AccountWire }>(await registerOtherSavings(t))
    expect(log.registered).toHaveLength(1)
    expect(log.registered[0]).toMatchObject({
      userId: VIEWER_ID,
      accountId: account.common.accountId,
      accountKind: 'other_savings',
    })
    expect(log.initialBalance).toHaveLength(1)
    expect(log.initialBalance[0]).toMatchObject({
      userId: VIEWER_ID,
      accountId: account.common.accountId,
      initialBalance: 500000,
    })
  })

  it('NISA 口座を登録できる（201）', async () => {
    const t = createTestApp()
    const res = await registerNisa(t)
    expect(res.status).toBe(201)
    const { account } = await json<{ account: AccountWire }>(res)
    expect(account.kind).toBe('nisa')
    expect(account.brokerageName).toEqual({ kind: 'sbi' })
    expect(account.contribution?.currentAccumulated).toBe(200000)
  })

  it('同種別の重複登録は 409（同一ユーザー × 口座種別の一意性）', async () => {
    const t = createTestApp()
    await registerOtherSavings(t)
    const res = await registerOtherSavings(t, { bankName: '住信SBIネット銀行' })
    expect(res.status).toBe(409)
  })

  it('配偶者は自分の口座として同種別を登録できる（ユーザー毎に一意）', async () => {
    const t = createTestApp()
    await registerOtherSavings(t)
    const res = await registerOtherSavings(t, { viewerId: SPOUSE_ID })
    expect(res.status).toBe(201)
  })

  it('SMBC 銀行・三井住友カードは登録対象外（400）', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/accounts', {
      body: { kind: 'smbc_bank', initialBalance: 0 },
    })
    expect(res.status).toBe(400)
  })

  it('空の銀行名は 400（BankName の不変条件）', async () => {
    const t = createTestApp()
    const res = await registerOtherSavings(t, { bankName: '' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/accounts', () => {
  it('自分が所有する口座のみを返す（配偶者の口座は含まない）', async () => {
    const t = createTestApp()
    await registerOtherSavings(t)
    await registerOtherSavings(t, { bankName: 'あおぞら銀行', viewerId: SPOUSE_ID })
    const res = await request(t.app, 'GET', '/api/accounts')
    expect(res.status).toBe(200)
    const { items } = await json<{ items: AccountWire[] }>(res)
    expect(items).toHaveLength(1)
    expect(items[0]?.common.ownerUserId).toBe(VIEWER_ID)
  })
})

describe('PUT /api/accounts/:accountId/bank-name', () => {
  it('所有する別銀行貯蓄口座の銀行名を変更できる', async () => {
    const t = createTestApp()
    const { account } = await json<{ account: AccountWire }>(await registerOtherSavings(t))
    const res = await request(t.app, 'PUT', `/api/accounts/${account.common.accountId}/bank-name`, {
      body: { bankName: '住信SBIネット銀行' },
    })
    expect(res.status).toBe(200)
    const updated = await json<{ account: AccountWire }>(res)
    expect(updated.account.bankName).toBe('住信SBIネット銀行')
    expect(updated.account.balance?.currentBalance).toBe(500000)
  })

  it('変更で BankNameChanged（旧名・新名・変更者）を発行する', async () => {
    const t = createTestApp()
    const log = subscribeEvents(t)
    const { account } = await json<{ account: AccountWire }>(await registerOtherSavings(t))
    await request(t.app, 'PUT', `/api/accounts/${account.common.accountId}/bank-name`, {
      body: { bankName: '住信SBIネット銀行' },
    })
    expect(log.bankNameChanged).toHaveLength(1)
    expect(log.bankNameChanged[0]).toMatchObject({
      accountId: account.common.accountId,
      oldBankName: '楽天銀行',
      newBankName: '住信SBIネット銀行',
      changedByUserId: VIEWER_ID,
    })
  })

  it('配偶者の口座は 403（所有者本人のみ変更可）', async () => {
    const t = createTestApp()
    const { account } = await json<{ account: AccountWire }>(await registerOtherSavings(t))
    const res = await request(t.app, 'PUT', `/api/accounts/${account.common.accountId}/bank-name`, {
      viewerId: SPOUSE_ID,
      body: { bankName: '乗っ取り銀行' },
    })
    expect(res.status).toBe(403)
  })

  it('存在しない口座は 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'PUT', '/api/accounts/01HZZZZZZZZZZZZZZZZZZZZZ99/bank-name', {
      body: { bankName: '楽天銀行' },
    })
    expect(res.status).toBe(404)
  })

  it('非所有者による種別不一致の口座への変更は 403（所有者チェックを先行し種別を漏らさない）', async () => {
    const t = createTestApp()
    // 配偶者が NISA 口座（bank-name の対象外種別）を登録
    const nisaRes = await request(t.app, 'POST', '/api/accounts', {
      viewerId: SPOUSE_ID,
      body: { kind: 'nisa', brokerageName: { kind: 'sbi' }, initialAccumulated: 200000 },
    })
    const { account } = await json<{ account: AccountWire }>(nisaRes)
    // 非所有者(VIEWER)が銀行名変更を試みる。所有者チェックが種別絞り込みより先に走り
    // 409（種別不一致）ではなく 403 を返す（存在・種別を非所有者に漏らさない）
    const res = await request(t.app, 'PUT', `/api/accounts/${account.common.accountId}/bank-name`, {
      body: { bankName: '楽天銀行' },
    })
    expect(res.status).toBe(403)
  })

  it('NISA 口座への銀行名変更は 409（種別不一致）', async () => {
    const t = createTestApp()
    const { account } = await json<{ account: AccountWire }>(await registerNisa(t))
    const res = await request(t.app, 'PUT', `/api/accounts/${account.common.accountId}/bank-name`, {
      body: { bankName: '楽天銀行' },
    })
    expect(res.status).toBe(409)
  })
})

describe('PUT /api/accounts/:accountId/brokerage-name', () => {
  it('所有する NISA 口座の証券会社名を変更できる（その他証券会社の任意名）', async () => {
    const t = createTestApp()
    const { account } = await json<{ account: AccountWire }>(await registerNisa(t))
    const res = await request(
      t.app,
      'PUT',
      `/api/accounts/${account.common.accountId}/brokerage-name`,
      { body: { brokerageName: { kind: 'other', customName: 'マネックス証券' } } },
    )
    expect(res.status).toBe(200)
    const updated = await json<{ account: AccountWire }>(res)
    expect(updated.account.brokerageName).toEqual({ kind: 'other', customName: 'マネックス証券' })
    expect(updated.account.contribution?.currentAccumulated).toBe(200000)
  })

  it('変更で BrokerageNameChanged（旧名・新名・変更者）を発行する', async () => {
    const t = createTestApp()
    const log = subscribeEvents(t)
    const { account } = await json<{ account: AccountWire }>(await registerNisa(t))
    await request(t.app, 'PUT', `/api/accounts/${account.common.accountId}/brokerage-name`, {
      body: { brokerageName: { kind: 'rakuten' } },
    })
    expect(log.brokerageNameChanged).toHaveLength(1)
    expect(log.brokerageNameChanged[0]).toMatchObject({
      accountId: account.common.accountId,
      oldBrokerageName: { kind: 'sbi' },
      newBrokerageName: { kind: 'rakuten' },
      changedByUserId: VIEWER_ID,
    })
  })

  it('別銀行貯蓄口座への証券会社名変更は 409（種別不一致）', async () => {
    const t = createTestApp()
    const { account } = await json<{ account: AccountWire }>(await registerOtherSavings(t))
    const res = await request(
      t.app,
      'PUT',
      `/api/accounts/${account.common.accountId}/brokerage-name`,
      { body: { brokerageName: { kind: 'rakuten' } } },
    )
    expect(res.status).toBe(409)
  })
})
