import { describe, it, expect } from 'vitest'
import {
  canListAccountInBalanceList,
  canViewAccountDetail,
  spouseVisibleAssetTotal,
} from '../../../src/balance-asset-tracking/services/balanceListVisibility'
import {
  inactivateAccount,
  registerMitsuiSumitomoCardAccount,
  registerNisaAccount,
  registerOtherSavingsAccount,
  registerSmbcBankAccount,
} from '../../../src/balance-asset-tracking/aggregates/Account'

const VIEWER = 'user_honey' as never
const SPOUSE = 'user_darling' as never
const at = new Date('2026-07-01T00:00:00Z')

const smbc = (ownerUserId: unknown, currentBalance: number) =>
  registerSmbcBankAccount({
    accountId: '01ACC000000000000000000001' as never,
    ownerUserId: ownerUserId as never,
    initialBalance: currentBalance as never,
    at,
  })

const card = (ownerUserId: unknown) =>
  registerMitsuiSumitomoCardAccount({
    accountId: '01ACC000000000000000000002' as never,
    ownerUserId: ownerUserId as never,
    unpaidAggregateRef: '01ACD000000000000000000009' as never,
    at,
  })

const savings = (ownerUserId: unknown, initialBalance: number) =>
  registerOtherSavingsAccount({
    accountId: '01ACC000000000000000000003' as never,
    ownerUserId: ownerUserId as never,
    bankName: '楽天銀行' as never,
    initialBalance: initialBalance as never,
    at,
  })

const nisa = (ownerUserId: unknown, initialAccumulated: number) =>
  registerNisaAccount({
    accountId: '01ACC000000000000000000004' as never,
    ownerUserId: ownerUserId as never,
    brokerageName: { kind: 'sbi' },
    initialAccumulated: initialAccumulated as never,
    at,
  })

const closed = (account: ReturnType<typeof savings>, ownerUserId: unknown) =>
  inactivateAccount(account, {
    reason: '解約したため',
    operatorUserId: ownerUserId as never,
    at: new Date('2026-07-05T00:00:00Z'),
  })

describe('canListAccountInBalanceList（残高一覧に 1 件として並べてよいか）', () => {
  it('本人の active 口座は並べる', () => {
    expect(canListAccountInBalanceList(smbc(VIEWER, 1_500_000), VIEWER)).toBe(true)
  })

  it('配偶者の口座は並べない（残高は本人のみ可視 — P2-B5）', () => {
    expect(canListAccountInBalanceList(smbc(SPOUSE, 1_500_000), VIEWER)).toBe(false)
  })

  it('本人でも非アクティブな口座は並べない', () => {
    expect(canListAccountInBalanceList(closed(savings(VIEWER, 800_000), VIEWER), VIEWER)).toBe(
      false,
    )
  })
})

describe('canViewAccountDetail（口座詳細を見てよいか）', () => {
  it('本人の口座は見てよい', () => {
    expect(canViewAccountDetail(smbc(VIEWER, 1_500_000), VIEWER)).toBe(true)
  })

  it('配偶者の口座は見せない（口座ごとの残高は本人のみ可視 — P2-B5）', () => {
    expect(canViewAccountDetail(smbc(SPOUSE, 1_500_000), VIEWER)).toBe(false)
  })

  it('本人の非アクティブな口座は見てよい（一覧に並べないのとは別の話）', () => {
    // 閉じた口座こそ「いつ閉じたのか・それまでどう動いたのか」を確かめる先が要る
    expect(canViewAccountDetail(closed(savings(VIEWER, 800_000), VIEWER), VIEWER)).toBe(true)
  })
})

describe('spouseVisibleAssetTotal（配偶者について見せてよい合計）', () => {
  it('配偶者の別銀行貯蓄と NISA 積立累計を合算する', () => {
    const total = spouseVisibleAssetTotal([savings(SPOUSE, 800_000), nisa(SPOUSE, 300_000)], SPOUSE)
    expect(total).toBe(1_100_000)
  })

  it('配偶者の SMBC 残高・カード未払金は合計に含めない', () => {
    const total = spouseVisibleAssetTotal(
      [smbc(SPOUSE, 1_500_000), card(SPOUSE), savings(SPOUSE, 800_000)],
      SPOUSE,
    )
    expect(total).toBe(800_000)
  })

  it('本人の口座は合計に混ぜない', () => {
    const total = spouseVisibleAssetTotal([savings(VIEWER, 900_000), nisa(SPOUSE, 300_000)], SPOUSE)
    expect(total).toBe(300_000)
  })

  it('配偶者の非アクティブな口座は合計に含めない', () => {
    const total = spouseVisibleAssetTotal(
      [closed(savings(SPOUSE, 800_000), SPOUSE), nisa(SPOUSE, 300_000)],
      SPOUSE,
    )
    expect(total).toBe(300_000)
  })

  it('残高が 0 円でも 0 を返す（口座が無いことにしない）', () => {
    // 取り崩して 0 円になった口座を「持っていない」に倒すと、合計行が黙って消える
    expect(spouseVisibleAssetTotal([savings(SPOUSE, 0)], SPOUSE)).toBe(0)
  })

  it('配偶者に別銀行貯蓄も NISA も無ければ null を返す', () => {
    expect(
      spouseVisibleAssetTotal([smbc(SPOUSE, 1_500_000), savings(VIEWER, 900_000)], SPOUSE),
    ).toBeNull()
  })

  it('許可リストに無い第三者の口座は「本人以外」でも合計に混ぜない（#595）', () => {
    const outsider = 'user_outsider' as never
    const total = spouseVisibleAssetTotal(
      [savings(outsider, 999_999), nisa(SPOUSE, 300_000)],
      SPOUSE,
    )
    expect(total).toBe(300_000)
  })
})
