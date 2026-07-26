import { describe, it, expect, beforeEach } from 'vitest'
import {
  AccountIdSchema,
  InvariantViolationError,
  money,
  registerOtherSavingsAccount,
} from '@warimaru/domain'
import type { AccountBalanceUpdated, UserId } from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { applyOtherSavingsTransferFromWithdrawal } from '../../src/balance/bank-deposit-purpose-service.js'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

/**
 * 別銀行貯蓄口座への振込（= シャドウ残高加算、08d §2）。
 * 実運用の発火元は日次メール取込バッチ（#414 / #35）で、#390 では反映側のみ先行実装している。
 */
describe('applyOtherSavingsTransferFromWithdrawal', () => {
  let t: TestApp

  beforeEach(() => {
    t = createTestApp()
  })

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

  const at = new Date('2026-07-25T03:00:00Z')

  function deps(): Parameters<typeof applyOtherSavingsTransferFromWithdrawal>[0] {
    return { accountRepository: t.deps.accountRepository, eventBus: t.deps.eventBus }
  }

  it('別銀行貯蓄残高が振込額だけ増える', async () => {
    const accountId = await registerSavings(VIEWER_ID, 500_000)

    await applyOtherSavingsTransferFromWithdrawal(deps(), {
      userId: VIEWER_ID,
      amount: money(50_000),
      transactionId: newUlid(),
      at,
    })

    const account = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    expect(account?.kind === 'other_savings' && account.balance.currentBalance).toBe(550_000)
  })

  it('残高鮮度の根拠も進む（家計分析の「最終更新から N 日」が実態とずれないようにする）', async () => {
    const accountId = await registerSavings(VIEWER_ID, 500_000)

    await applyOtherSavingsTransferFromWithdrawal(deps(), {
      userId: VIEWER_ID,
      amount: money(50_000),
      transactionId: newUlid(),
      at,
    })

    const account = await t.deps.accountRepository.findById(AccountIdSchema.parse(accountId))
    expect(account?.kind === 'other_savings' && account.freshnessSource.lastUpdatedAt).toEqual(at)
  })

  it('口座残高更新イベントが加算として発行される', async () => {
    await registerSavings(VIEWER_ID, 500_000)
    const events: AccountBalanceUpdated[] = []
    t.deps.eventBus.subscribe<AccountBalanceUpdated>(
      'AccountBalanceUpdated',
      e => void events.push(e),
    )

    await applyOtherSavingsTransferFromWithdrawal(deps(), {
      userId: VIEWER_ID,
      amount: money(50_000),
      transactionId: newUlid(),
      at,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ delta: 50_000, newBalance: 550_000 })
  })

  it('別銀行貯蓄口座が未登録なら失敗する（SMBC 側だけ減った状態を黙認しない）', async () => {
    await expect(
      applyOtherSavingsTransferFromWithdrawal(deps(), {
        userId: VIEWER_ID,
        amount: money(50_000),
        transactionId: newUlid(),
        at,
      }),
    ).rejects.toThrow(InvariantViolationError)
  })

  it('配偶者名義の口座は動かさない（口座は所有者ごとに解決する）', async () => {
    const spouseAccountId = await registerSavings(SPOUSE_ID, 500_000)

    await expect(
      applyOtherSavingsTransferFromWithdrawal(deps(), {
        userId: VIEWER_ID,
        amount: money(50_000),
        transactionId: newUlid(),
        at,
      }),
    ).rejects.toThrow(InvariantViolationError)

    const spouseAccount = await t.deps.accountRepository.findById(
      AccountIdSchema.parse(spouseAccountId),
    )
    expect(spouseAccount?.kind === 'other_savings' && spouseAccount.balance.currentBalance).toBe(
      500_000,
    )
  })

  it.each([0, -1])('%i 円の振込は反映しない', async amount => {
    await registerSavings(VIEWER_ID, 500_000)

    await expect(
      applyOtherSavingsTransferFromWithdrawal(deps(), {
        userId: VIEWER_ID,
        amount: money(amount),
        transactionId: newUlid(),
        at,
      }),
    ).rejects.toThrow(InvariantViolationError)
  })
})
