import { describe, it, expect } from 'vitest'
import {
  AccountIdSchema,
  asOtherSavingsAccount,
  inactivateAccount,
  money,
  withdrawOtherSavings,
} from '@warimaru/domain'
import { PostgresAccountDetailQuery } from '../../src/balance-asset-tracking/PostgresAccountDetailQuery'
import { PostgresBalanceHistoryRepository } from '../../src/balance-asset-tracking/PostgresBalanceHistoryRepository'
import { PostgresAccountRepository } from '../../src/balance-asset-tracking/PostgresAccountRepository'
import { PostgresMitsuiSumitomoUnpaidRepository } from '../../src/balance-asset-tracking/PostgresMitsuiSumitomoUnpaidRepository'
import { newUlid } from '../../src/newId'
import { db } from './setup'
import {
  DARLING_USER_ID,
  HONEY_USER_ID,
  balanceHistoryEntry,
  cardAccount,
  nisaAccount,
  otherSavingsAccount,
  unpaidAggregate,
  ym,
} from '../helpers/fixtures'

const accounts = new PostgresAccountRepository(db)
const history = new PostgresBalanceHistoryRepository(db)
const unpaids = new PostgresMitsuiSumitomoUnpaidRepository(db)
const query = new PostgresAccountDetailQuery(db)

describe('PostgresAccountDetailQuery', () => {
  it('本人の口座は、その口座だけの推移と履歴を返す（手入力の種別とメモを添える）', async () => {
    const withdrawnAt = new Date('2026-05-20T00:00:00.000Z')
    // 手入力の記録は口座に積まれ、値そのものは残高変動履歴に残る。この 2 つが
    // 発生日時で突き合わされることを、ドメイン関数を通して作った口座で確かめる
    const account = withdrawOtherSavings(
      asOtherSavingsAccount(otherSavingsAccount({ currentBalance: 800000 })),
      {
        amount: money(30000),
        operatorUserId: DARLING_USER_ID,
        at: withdrawnAt,
        memo: '旅行費として引き出し',
      },
    )
    await accounts.save(account)
    const accountId = account.common.accountId

    // 同じ軸の別口座（この口座の線にも履歴にも入ってはいけない）
    const other = otherSavingsAccount({ ownerUserId: HONEY_USER_ID })
    await accounts.save(other)
    await history.append(
      balanceHistoryEntry({
        accountId: other.common.accountId,
        axis: 'other_savings_balance',
        value: 999999,
        occurredAt: new Date('2026-05-15T00:00:00.000Z'),
      }),
    )

    await history.append(
      balanceHistoryEntry({
        accountId,
        axis: 'other_savings_balance',
        value: 830000,
        occurredAt: new Date('2026-05-10T00:00:00.000Z'),
      }),
    )
    await history.append(
      balanceHistoryEntry({
        accountId,
        axis: 'other_savings_balance',
        value: 800000,
        occurredAt: withdrawnAt,
      }),
    )

    const view = await query.fetch(DARLING_USER_ID, accountId, ym('2026-04'), ym('2026-06'))

    expect(view).not.toBeNull()
    expect(view?.kind).toBe('other_savings')
    expect(view?.currentValue).toBe(770000)
    expect(view?.supportsBalanceManualEntry).toBe(true)
    expect(view?.series.map(p => p.amount)).toEqual([830000, 800000])
    // 履歴は新しい順。増減は直前の値との差で、手入力の行だけ種別とメモが付く
    expect(view?.history).toMatchObject([
      {
        valueAfter: 800000,
        delta: -30000,
        source: 'manual_withdrawal',
        memo: '旅行費として引き出し',
      },
      { valueAfter: 830000, delta: null, source: 'auto' },
    ])
  })

  it('期間より前の最後の値を期間の起点に置く（期間中に動きが無くても線が消えない）', async () => {
    const account = otherSavingsAccount({ currentBalance: 500000 })
    await accounts.save(account)
    await history.append(
      balanceHistoryEntry({
        accountId: account.common.accountId,
        axis: 'other_savings_balance',
        value: 500000,
        occurredAt: new Date('2026-01-15T00:00:00.000Z'),
      }),
    )

    const view = await query.fetch(
      DARLING_USER_ID,
      account.common.accountId,
      ym('2026-04'),
      ym('2026-06'),
    )

    expect(view?.series).toHaveLength(1)
    expect(view?.series[0]?.amount).toBe(500000)
    // 起点は期間の開始時刻に置く（JST の 4 月 1 日 = UTC 3/31 15:00）
    expect(view?.series[0]?.date).toEqual(new Date('2026-03-31T15:00:00.000Z'))
    // 起点そのものは履歴の行にしない（期間外に起きた変動のため）
    expect(view?.history).toEqual([])
  })

  it('他人の口座は null を返す（口座ごとの残高は本人のみ可視）', async () => {
    const account = otherSavingsAccount({ ownerUserId: DARLING_USER_ID })
    await accounts.save(account)
    await history.append(
      balanceHistoryEntry({
        accountId: account.common.accountId,
        axis: 'other_savings_balance',
        value: 800000,
        occurredAt: new Date('2026-05-10T00:00:00.000Z'),
      }),
    )

    const view = await query.fetch(
      HONEY_USER_ID,
      account.common.accountId,
      ym('2026-04'),
      ym('2026-06'),
    )

    expect(view).toBeNull()
  })

  it('存在しない口座も null を返す（他人の口座と応答を変えない）', async () => {
    const view = await query.fetch(
      HONEY_USER_ID,
      AccountIdSchema.parse(newUlid()),
      ym('2026-04'),
      ym('2026-06'),
    )

    expect(view).toBeNull()
  })

  it('使っていない口座（非アクティブ）も返す（閉じた口座の履歴を確かめられる）', async () => {
    const account = inactivateAccount(
      asOtherSavingsAccount(otherSavingsAccount({ currentBalance: 300000 })),
      {
        reason: '使わなくなったため',
        operatorUserId: DARLING_USER_ID,
        at: new Date('2026-06-01T00:00:00.000Z'),
      },
    )
    await accounts.save(account)

    const view = await query.fetch(
      DARLING_USER_ID,
      account.common.accountId,
      ym('2026-04'),
      ym('2026-06'),
    )

    expect(view).not.toBeNull()
    expect(view?.isActive).toBe(false)
    expect(view?.currentValue).toBe(300000)
  })

  it('NISA 口座は積立累計を返す（手入力の残高操作は受け付けない）', async () => {
    const account = nisaAccount({ ownerUserId: HONEY_USER_ID, currentAccumulated: 450000 })
    await accounts.save(account)

    const view = await query.fetch(
      HONEY_USER_ID,
      account.common.accountId,
      ym('2026-04'),
      ym('2026-07'),
    )

    expect(view?.kind).toBe('nisa')
    expect(view?.currentValue).toBe(450000)
    expect(view?.supportsBalanceManualEntry).toBe(false)
  })

  it('一度も精算していないカード口座の最終更新日時は null（登録日で代用しない）', async () => {
    const account = cardAccount({ ownerUserId: HONEY_USER_ID })
    await accounts.save(account)
    await unpaids.save(
      unpaidAggregate({ accountId: account.common.accountId, withSettledEntry: false }),
    )

    const view = await query.fetch(
      HONEY_USER_ID,
      account.common.accountId,
      ym('2026-04'),
      ym('2026-07'),
    )

    expect(view?.lastUpdatedAt).toBeNull()
    expect(view?.currentValue).toBe(42000)
  })

  it('カード口座は未払金集約の当月未払い合計と前回精算日を返す（手入力は受け付けない）', async () => {
    const account = cardAccount({ ownerUserId: HONEY_USER_ID })
    await accounts.save(account)
    await unpaids.save(
      unpaidAggregate({ accountId: account.common.accountId, withSettledEntry: true }),
    )

    const view = await query.fetch(
      HONEY_USER_ID,
      account.common.accountId,
      ym('2026-04'),
      ym('2026-07'),
    )

    expect(view?.kind).toBe('mitsui_sumitomo_card')
    expect(view?.currentValue).toBe(42000)
    expect(view?.lastUpdatedAt).toEqual(new Date('2026-06-26T00:00:00.000Z'))
    expect(view?.supportsBalanceManualEntry).toBe(false)
  })
})
