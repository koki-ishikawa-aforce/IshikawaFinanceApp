import { describe, it, expect } from 'vitest'
import { createApp } from '../../src/app.js'
import { createDeps } from '../../src/composition-root.js'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request } from '../helpers/test-app.js'

async function seedCsvConfirmedCycle(t: TestApp): Promise<string> {
  const createRes = await request(t.app, 'POST', '/api/expense-settlement/cycles', {
    body: { targetMonth: '2026-07' },
  })
  expect(createRes.status).toBe(201)
  const cycleId = ((await createRes.json()) as { common: { monthlyExpenseCycleId: string } }).common
    .monthlyExpenseCycleId
  const confirmRes = await request(
    t.app,
    'PUT',
    `/api/expense-settlement/cycles/${cycleId}/confirm-csv`,
  )
  expect(confirmRes.status).toBe(200)
  return cycleId
}

async function seedDeposit(t: TestApp): Promise<string> {
  const res = await request(t.app, 'POST', '/api/expense-settlement/deposits', {
    body: { depositAmount: 5000 },
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { common: { expenseReimbursementId: string } }).common
    .expenseReimbursementId
}

describe('PUT /api/expense-settlement/cycles/:id/finalize', () => {
  it('正常系: サイクルが確定し入金が突合される', async () => {
    const t = createTestApp()
    const cycleId = await seedCsvConfirmedCycle(t)
    const depositId = await seedDeposit(t)
    const res = await request(t.app, 'PUT', `/api/expense-settlement/cycles/${cycleId}/finalize`, {
      body: { expenseReimbursementId: depositId },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cycle: { kind: string }; deposit: { kind: string } }
    expect(body.cycle.kind).toBe('finalized')
    expect(body.deposit.kind).toBe('matched')
  })

  it('リプレイ: 確定済みサイクル + 突合済み入金の再実行は 200 で現状を返す', async () => {
    const t = createTestApp()
    const cycleId = await seedCsvConfirmedCycle(t)
    const depositId = await seedDeposit(t)
    await request(t.app, 'PUT', `/api/expense-settlement/cycles/${cycleId}/finalize`, {
      body: { expenseReimbursementId: depositId },
    })
    const replay = await request(
      t.app,
      'PUT',
      `/api/expense-settlement/cycles/${cycleId}/finalize`,
      { body: { expenseReimbursementId: depositId } },
    )
    expect(replay.status).toBe(200)
    const body = (await replay.json()) as { cycle: { kind: string }; deposit: { kind: string } }
    expect(body.cycle.kind).toBe('finalized')
    expect(body.deposit.kind).toBe('matched')
  })

  it('復旧: サイクル保存後に入金保存が失敗しても、再実行で突合が完了する', async () => {
    // 入金 save が 1 回目だけ失敗する（= サイクル確定と入金突合の間のクラッシュを再現）
    const deps = createDeps({})
    const original = deps.expenseReimbursementDepositRepository
    let failNextMatchedSave = true
    deps.expenseReimbursementDepositRepository = {
      ...original,
      async save(deposit) {
        if (deposit.kind === 'matched' && failNextMatchedSave) {
          failNextMatchedSave = false
          throw new Error('injected save failure')
        }
        return original.save(deposit)
      },
    }
    const t: TestApp = { app: createApp(deps), deps }

    const cycleId = await seedCsvConfirmedCycle(t)
    const depositId = await seedDeposit(t)
    const crashed = await request(
      t.app,
      'PUT',
      `/api/expense-settlement/cycles/${cycleId}/finalize`,
      { body: { expenseReimbursementId: depositId } },
    )
    expect(crashed.status).toBe(500)

    // サイクルは確定済み・入金は突合待ちの中間状態
    const cycle = await deps.monthlyExpenseCycleRepository.findById(cycleId as never)
    expect(cycle?.kind).toBe('finalized')
    const deposit = await deps.expenseReimbursementDepositRepository.findById(depositId as never)
    expect(deposit?.kind).toBe('awaiting_match')

    // 再実行で突合のみ完了する
    const retry = await request(
      t.app,
      'PUT',
      `/api/expense-settlement/cycles/${cycleId}/finalize`,
      { body: { expenseReimbursementId: depositId } },
    )
    expect(retry.status).toBe(200)
    const body = (await retry.json()) as { deposit: { kind: string } }
    expect(body.deposit.kind).toBe('matched')
  })

  it('確定済みサイクルへ別の入金 ID を渡すと 409', async () => {
    const t = createTestApp()
    const cycleId = await seedCsvConfirmedCycle(t)
    const depositId = await seedDeposit(t)
    await request(t.app, 'PUT', `/api/expense-settlement/cycles/${cycleId}/finalize`, {
      body: { expenseReimbursementId: depositId },
    })
    const other = await seedDeposit(t)
    const res = await request(t.app, 'PUT', `/api/expense-settlement/cycles/${cycleId}/finalize`, {
      body: { expenseReimbursementId: other },
    })
    expect(res.status).toBe(409)
  })

  it('集積中サイクルの最終確定は 409', async () => {
    const t = createTestApp()
    const createRes = await request(t.app, 'POST', '/api/expense-settlement/cycles', {
      body: { targetMonth: '2026-07' },
    })
    const cycleId = ((await createRes.json()) as { common: { monthlyExpenseCycleId: string } })
      .common.monthlyExpenseCycleId
    const depositId = await seedDeposit(t)
    const res = await request(t.app, 'PUT', `/api/expense-settlement/cycles/${cycleId}/finalize`, {
      body: { expenseReimbursementId: depositId },
    })
    expect(res.status).toBe(409)
  })
})
