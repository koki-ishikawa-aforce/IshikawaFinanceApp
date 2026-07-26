import { describe, it, expect } from 'vitest'
import type {
  AccountInactivated,
  AccountRegistered,
  BankNameChanged,
  BrokerageNameChanged,
  InitialBalanceCorrected,
  InitialBalanceRegistered,
  NisaContributionAdded,
  OtherSavingsBalanceUpdated,
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

// --- #397: 残高の手動操作 ---

interface ManualEventLog {
  otherSavingsUpdated: OtherSavingsBalanceUpdated[]
  nisaContributionAdded: NisaContributionAdded[]
  initialBalanceCorrected: InitialBalanceCorrected[]
  inactivated: AccountInactivated[]
}

function subscribeManualEvents(t: TestApp): ManualEventLog {
  const log: ManualEventLog = {
    otherSavingsUpdated: [],
    nisaContributionAdded: [],
    initialBalanceCorrected: [],
    inactivated: [],
  }
  t.deps.eventBus.subscribe<OtherSavingsBalanceUpdated>('OtherSavingsBalanceUpdated', e => {
    log.otherSavingsUpdated.push(e)
  })
  t.deps.eventBus.subscribe<NisaContributionAdded>('NisaContributionAdded', e => {
    log.nisaContributionAdded.push(e)
  })
  t.deps.eventBus.subscribe<InitialBalanceCorrected>('InitialBalanceCorrected', e => {
    log.initialBalanceCorrected.push(e)
  })
  t.deps.eventBus.subscribe<AccountInactivated>('AccountInactivated', e => {
    log.inactivated.push(e)
  })
  return log
}

async function accountId(res: Response): Promise<string> {
  const { account } = await json<{ account: AccountWire }>(res)
  return account.common.accountId
}

describe('POST /api/accounts/:accountId/transfer-in', () => {
  it('別銀行貯蓄口座に振込額を加算し、OtherSavingsBalanceUpdated を発行する', async () => {
    const t = createTestApp()
    const log = subscribeManualEvents(t)
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/transfer-in`, {
      body: { amount: 50000 },
    })
    expect(res.status).toBe(200)
    const { account } = await json<{ account: AccountWire }>(res)
    expect(account.balance?.currentBalance).toBe(550000)
    expect(log.otherSavingsUpdated).toHaveLength(1)
    expect(log.otherSavingsUpdated[0]).toMatchObject({
      accountId: id,
      delta: 50000,
      newBalance: 550000,
      source: 'smbc_transfer_addition',
    })
  })

  it('NISA 口座に積立額を加算し、NisaContributionAdded を発行する', async () => {
    const t = createTestApp()
    const log = subscribeManualEvents(t)
    const id = await accountId(await registerNisa(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/transfer-in`, {
      body: { amount: 33333 },
    })
    expect(res.status).toBe(200)
    const { account } = await json<{ account: AccountWire }>(res)
    expect(account.contribution?.currentAccumulated).toBe(233333)
    expect(log.nisaContributionAdded).toHaveLength(1)
    expect(log.nisaContributionAdded[0]).toMatchObject({
      accountId: id,
      addedAmount: 33333,
      newAccumulated: 233333,
      brokerageName: { kind: 'sbi' },
    })
  })

  it('0 円は加算できない（400）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/transfer-in`, {
      body: { amount: 0 },
    })
    expect(res.status).toBe(400)
  })

  it('配偶者の口座には加算できない（403）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/transfer-in`, {
      viewerId: SPOUSE_ID,
      body: { amount: 1000 },
    })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/accounts/:accountId/withdraw', () => {
  it('取り崩し額を減算し、manual_withdrawal 由来のイベントを発行する', async () => {
    const t = createTestApp()
    const log = subscribeManualEvents(t)
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/withdraw`, {
      body: { amount: 120000 },
    })
    expect(res.status).toBe(200)
    const { account } = await json<{ account: AccountWire }>(res)
    expect(account.balance?.currentBalance).toBe(380000)
    expect(log.otherSavingsUpdated[0]).toMatchObject({
      delta: -120000,
      newBalance: 380000,
      source: 'manual_withdrawal',
    })
  })

  it('残高を超える取り崩しは 409（負残高にしない）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/withdraw`, {
      body: { amount: 500001 },
    })
    expect(res.status).toBe(409)
  })

  it('配偶者は取り崩しを記録できない（403）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/withdraw`, {
      viewerId: SPOUSE_ID,
      body: { amount: 1000 },
    })
    expect(res.status).toBe(403)
  })

  it('NISA 口座は取り崩しの対象外（409）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerNisa(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/withdraw`, {
      body: { amount: 1000 },
    })
    expect(res.status).toBe(409)
  })
})

describe('PUT /api/accounts/:accountId/balance', () => {
  it('実際の残高へ差し替え、manual_correction 由来のイベントを発行する', async () => {
    const t = createTestApp()
    const log = subscribeManualEvents(t)
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'PUT', `/api/accounts/${id}/balance`, {
      body: { balance: 432100 },
    })
    expect(res.status).toBe(200)
    const { account } = await json<{ account: AccountWire }>(res)
    expect(account.balance?.currentBalance).toBe(432100)
    expect(log.otherSavingsUpdated[0]).toMatchObject({
      delta: -67900,
      newBalance: 432100,
      source: 'manual_correction',
    })
  })

  it('負の残高へは補正できない（409）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'PUT', `/api/accounts/${id}/balance`, {
      body: { balance: -1 },
    })
    expect(res.status).toBe(409)
  })

  it('配偶者は補正できない（403）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'PUT', `/api/accounts/${id}/balance`, {
      viewerId: SPOUSE_ID,
      body: { balance: 1 },
    })
    expect(res.status).toBe(403)
  })
})

describe('PUT /api/accounts/:accountId/initial-balance', () => {
  it('初期残高を修正すると現在残高も同じ差分ずれ、InitialBalanceCorrected を発行する', async () => {
    const t = createTestApp()
    const log = subscribeManualEvents(t)
    const id = await accountId(await registerOtherSavings(t))
    // 登録直後は 現在残高 = 初期残高 = 500000。初期を 450000 に直すと現在も 450000
    const res = await request(t.app, 'PUT', `/api/accounts/${id}/initial-balance`, {
      body: { initialBalance: 450000 },
    })
    expect(res.status).toBe(200)
    const { account } = await json<{ account: AccountWire }>(res)
    expect(account.balance?.initialBalance).toBe(450000)
    expect(account.balance?.currentBalance).toBe(450000)
    expect(log.initialBalanceCorrected).toHaveLength(1)
    expect(log.initialBalanceCorrected[0]).toMatchObject({
      accountId: id,
      oldInitialBalance: 500000,
      newInitialBalance: 450000,
      correctedByUserId: VIEWER_ID,
    })
  })

  it('以降の変動を保ったまま初期残高を修正できる', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    await request(t.app, 'POST', `/api/accounts/${id}/transfer-in`, { body: { amount: 100000 } })
    const res = await request(t.app, 'PUT', `/api/accounts/${id}/initial-balance`, {
      body: { initialBalance: 400000 },
    })
    const { account } = await json<{ account: AccountWire }>(res)
    // 初期 500000 → 400000（-100000）。現在 600000 も -100000 されて 500000
    expect(account.balance?.currentBalance).toBe(500000)
  })

  it('NISA 口座の初期累計も修正できる', async () => {
    const t = createTestApp()
    const id = await accountId(await registerNisa(t))
    const res = await request(t.app, 'PUT', `/api/accounts/${id}/initial-balance`, {
      body: { initialBalance: 150000 },
    })
    expect(res.status).toBe(200)
    const { account } = await json<{ account: AccountWire }>(res)
    // 登録直後は 現在累計 = 初期累計 = 200000。初期を 150000 に直すと現在も 150000
    expect(account.contribution?.initialAccumulated).toBe(150000)
    expect(account.contribution?.currentAccumulated).toBe(150000)
  })

  it('負の初期残高には修正できない（409）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'PUT', `/api/accounts/${id}/initial-balance`, {
      body: { initialBalance: -1 },
    })
    expect(res.status).toBe(409)
  })

  it('配偶者は修正できない（403）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'PUT', `/api/accounts/${id}/initial-balance`, {
      viewerId: SPOUSE_ID,
      body: { initialBalance: 1 },
    })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/accounts/:accountId/inactivate', () => {
  it('非アクティブ化すると理由が記録され、AccountInactivated を発行する', async () => {
    const t = createTestApp()
    const log = subscribeManualEvents(t)
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/inactivate`, {
      body: { reason: '解約したため' },
    })
    expect(res.status).toBe(200)
    const { account } = await json<{ account: AccountWire }>(res)
    expect(account.common.activeness.kind).toBe('inactive')
    expect(log.inactivated).toHaveLength(1)
    expect(log.inactivated[0]).toMatchObject({ accountId: id, reason: '解約したため' })
  })

  it('非アクティブ化した口座には残高操作ができない（409）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    await request(t.app, 'POST', `/api/accounts/${id}/inactivate`, {
      body: { reason: '解約したため' },
    })
    const res = await request(t.app, 'POST', `/api/accounts/${id}/withdraw`, {
      body: { amount: 1000 },
    })
    expect(res.status).toBe(409)
  })

  it('二度目の非アクティブ化は 409（最初に閉じた記録を上書きしない）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    await request(t.app, 'POST', `/api/accounts/${id}/inactivate`, { body: { reason: '解約' } })
    const res = await request(t.app, 'POST', `/api/accounts/${id}/inactivate`, {
      body: { reason: '別の理由' },
    })
    expect(res.status).toBe(409)
  })

  it('空の理由では非アクティブ化できない（400）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/inactivate`, {
      body: { reason: '' },
    })
    expect(res.status).toBe(400)
  })

  it('配偶者の口座は非アクティブ化できない（403）', async () => {
    const t = createTestApp()
    const id = await accountId(await registerOtherSavings(t))
    const res = await request(t.app, 'POST', `/api/accounts/${id}/inactivate`, {
      viewerId: SPOUSE_ID,
      body: { reason: '乗っ取り' },
    })
    expect(res.status).toBe(403)
  })
})
