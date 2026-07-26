import { describe, it, expect } from 'vitest'
import {
  AccountSchema,
  applyOtherSavingsBalanceChange,
  applyOtherSavingsMovement,
  applySmbcBalanceChange,
  applyUnpaidSettlementToSmbcBalance,
  asNisaAccount,
  asOtherSavingsAccount,
  changeBankName,
  changeBrokerageName,
  registerNisaAccount,
  registerOtherSavingsAccount,
  type NisaAccount,
  type OtherSavingsAccount,
  type SmbcBankAccount,
} from '../../../src/balance-asset-tracking/aggregates/Account'
import {
  InvariantViolationError,
  OtherSavingsMovementAlreadyAppliedError,
  PermissionDeniedError,
  UnpaidSettlementAlreadyAppliedError,
} from '../../../src/shared/errors/DomainError'

const baseCommon = {
  accountId: '01ACC000000000000000000001' as never,
  ownerUserId: 'user_honey' as never,
  registeredAt: new Date(),
  activeness: { kind: 'active' as const },
}

describe('Account 集約', () => {
  it('SMBC 銀行口座を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'smbc_bank',
        common: baseCommon,
        balance: {
          currentBalance: 100000 as never,
          initialBalance: 100000 as never,
          initialBalanceBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })

  it('三井住友カード口座を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'mitsui_sumitomo_card',
        common: baseCommon,
        unpaidAggregateRef: '01NP0000000000000000000001' as never,
      }),
    ).not.toThrow()
  })

  it('別銀行貯蓄口座（銀行名付き、Phase 3.5）を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'other_savings',
        common: baseCommon,
        bankName: '楽天銀行' as never,
        balance: {
          currentBalance: 500000 as never,
          initialBalance: 500000 as never,
          initialBalanceBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
        freshnessSource: { lastUpdatedAt: new Date() },
      }),
    ).not.toThrow()
  })

  it('NISA 口座（証券会社名付き、Phase 3.5）を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'nisa',
        common: baseCommon,
        brokerageName: { kind: 'sbi' },
        contribution: {
          currentAccumulated: 200000 as never,
          initialAccumulated: 0 as never,
          initialAccumulatedBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })

  it('NISA 口座でカスタム証券会社名を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'nisa',
        common: baseCommon,
        brokerageName: { kind: 'other', customName: 'マネックス証券' },
        contribution: {
          currentAccumulated: 100000 as never,
          initialAccumulated: 0 as never,
          initialAccumulatedBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })

  it('非アクティブ状態の口座も表現可能', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'smbc_bank',
        common: {
          ...baseCommon,
          activeness: {
            kind: 'inactive',
            inactivatedAt: new Date(),
            reason: '使わなくなったため',
          },
        },
        balance: {
          currentBalance: 0 as never,
          initialBalance: 100000 as never,
          initialBalanceBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })
})

// --- #48: 口座登録（設定画面 / オンボーディング Phase 2-B） ---

describe('registerOtherSavingsAccount()', () => {
  const at = new Date('2026-07-01')
  const register = () =>
    registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000002' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 500000 as never,
      at,
    })

  it('アクティブ状態で登録され、現在残高 = 初期残高になる', () => {
    const account = register()
    expect(account.kind).toBe('other_savings')
    expect(account.common.activeness.kind).toBe('active')
    expect(account.common.registeredAt).toEqual(at)
    expect(account.balance.currentBalance).toBe(500000)
    expect(account.balance.initialBalance).toBe(500000)
  })

  it('初期残高基準時刻・最終更新日時・残高鮮度根拠 = 登録日時（論点9）', () => {
    const account = register()
    expect(account.balance.initialBalanceBaselineAt).toEqual(at)
    expect(account.balance.lastUpdatedAt).toEqual(at)
    expect(account.freshnessSource.lastUpdatedAt).toEqual(at)
  })

  it('空の銀行名は登録できない（BankName の不変条件）', () => {
    expect(() =>
      registerOtherSavingsAccount({
        accountId: '01ACC000000000000000000002' as never,
        ownerUserId: 'user_honey' as never,
        bankName: '' as never,
        initialBalance: 0 as never,
        at,
      }),
    ).toThrow()
  })
})

describe('registerNisaAccount()', () => {
  const at = new Date('2026-07-01')

  it('アクティブ状態で登録され、現在累計 = 初期累計・基準時刻 = 登録日時になる', () => {
    const account = registerNisaAccount({
      accountId: '01ACC000000000000000000003' as never,
      ownerUserId: 'user_darling' as never,
      brokerageName: { kind: 'sbi' },
      initialAccumulated: 200000 as never,
      at,
    })
    expect(account.kind).toBe('nisa')
    expect(account.common.activeness.kind).toBe('active')
    expect(account.contribution.currentAccumulated).toBe(200000)
    expect(account.contribution.initialAccumulated).toBe(200000)
    expect(account.contribution.initialAccumulatedBaselineAt).toEqual(at)
    expect(account.contribution.lastUpdatedAt).toEqual(at)
  })

  it('その他証券会社は任意名で登録できる', () => {
    const account = registerNisaAccount({
      accountId: '01ACC000000000000000000003' as never,
      ownerUserId: 'user_darling' as never,
      brokerageName: { kind: 'other', customName: 'マネックス証券' },
      initialAccumulated: 0 as never,
      at,
    })
    expect(account.brokerageName).toEqual({ kind: 'other', customName: 'マネックス証券' })
  })
})

// --- #48: 銀行名・証券会社名の変更（Phase 3.5） ---

describe('changeBankName()', () => {
  const otherSavings = () =>
    AccountSchema.parse({
      kind: 'other_savings',
      common: baseCommon,
      bankName: '楽天銀行' as never,
      balance: {
        currentBalance: 500000 as never,
        initialBalance: 500000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
      freshnessSource: { lastUpdatedAt: new Date('2026-04-01') },
    }) as OtherSavingsAccount

  it('銀行名だけが変わり、残高・鮮度根拠は変更されない', () => {
    const updated = changeBankName(
      otherSavings(),
      '住信SBIネット銀行' as never,
      'user_honey' as never,
    )
    expect(updated.bankName).toBe('住信SBIネット銀行')
    expect(updated.balance).toEqual(otherSavings().balance)
    expect(updated.freshnessSource).toEqual(otherSavings().freshnessSource)
    expect(updated.common).toEqual(otherSavings().common)
  })

  it('空の銀行名には変更できない（BankName の不変条件）', () => {
    expect(() => changeBankName(otherSavings(), '' as never, 'user_honey' as never)).toThrow()
  })

  it('所有者本人以外の操作は PermissionDeniedError（配偶者の口座名は変更不可）', () => {
    expect(() =>
      changeBankName(otherSavings(), '住信SBIネット銀行' as never, 'user_darling' as never),
    ).toThrow(PermissionDeniedError)
  })
})

describe('changeBrokerageName()', () => {
  const nisa = () =>
    AccountSchema.parse({
      kind: 'nisa',
      common: baseCommon,
      brokerageName: { kind: 'sbi' },
      contribution: {
        currentAccumulated: 200000 as never,
        initialAccumulated: 0 as never,
        initialAccumulatedBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as NisaAccount

  it('証券会社名だけが変わり、積立累計は変更されない', () => {
    const updated = changeBrokerageName(nisa(), { kind: 'rakuten' }, 'user_honey' as never)
    expect(updated.brokerageName).toEqual({ kind: 'rakuten' })
    expect(updated.contribution).toEqual(nisa().contribution)
  })

  it('その他証券会社の空のカスタム名には変更できない', () => {
    expect(() =>
      changeBrokerageName(
        nisa(),
        { kind: 'other', customName: '' } as never,
        'user_honey' as never,
      ),
    ).toThrow()
  })

  it('所有者本人以外の操作は PermissionDeniedError', () => {
    expect(() => changeBrokerageName(nisa(), { kind: 'rakuten' }, 'user_darling' as never)).toThrow(
      PermissionDeniedError,
    )
  })
})

describe('asOtherSavingsAccount() / asNisaAccount()', () => {
  const smbc = () =>
    AccountSchema.parse({
      kind: 'smbc_bank',
      common: baseCommon,
      balance: {
        currentBalance: 0 as never,
        initialBalance: 0 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    })

  it('種別が一致すればそのまま返す', () => {
    const otherSavings = registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000002' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 0 as never,
      at: new Date('2026-07-01'),
    })
    expect(asOtherSavingsAccount(otherSavings)).toBe(otherSavings)
    const nisa = registerNisaAccount({
      accountId: '01ACC000000000000000000003' as never,
      ownerUserId: 'user_honey' as never,
      brokerageName: { kind: 'sbi' },
      initialAccumulated: 0 as never,
      at: new Date('2026-07-01'),
    })
    expect(asNisaAccount(nisa)).toBe(nisa)
  })

  it('種別不一致は InvariantViolationError', () => {
    expect(() => asOtherSavingsAccount(smbc())).toThrow(InvariantViolationError)
    expect(() => asNisaAccount(smbc())).toThrow(InvariantViolationError)
  })
})

// --- #65: SMBC 口座残高更新 ---

describe('applySmbcBalanceChange()', () => {
  const smbcAccount = () =>
    AccountSchema.parse({
      kind: 'smbc_bank',
      common: baseCommon,
      balance: {
        currentBalance: 100000 as never,
        initialBalance: 100000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as SmbcBankAccount

  it('正の delta（入金）で残高を加算し、最終更新日時を進める', () => {
    const at = new Date('2026-04-25')
    const updated = applySmbcBalanceChange(smbcAccount(), 30000 as never, at)
    expect(updated.balance.currentBalance).toBe(130000)
    expect(updated.balance.lastUpdatedAt).toEqual(at)
  })

  it('負の delta（出金・引落消込変動）で残高を減算する', () => {
    const updated = applySmbcBalanceChange(smbcAccount(), -8000 as never, new Date('2026-05-26'))
    expect(updated.balance.currentBalance).toBe(92000)
  })

  it('初期残高・基準時刻は変更されない', () => {
    const updated = applySmbcBalanceChange(smbcAccount(), -8000 as never, new Date('2026-05-26'))
    expect(updated.balance.initialBalance).toBe(100000)
    expect(updated.balance.initialBalanceBaselineAt).toEqual(new Date('2026-04-01'))
  })

  it('非アクティブ口座への残高変動は InvariantViolationError（09-aggregates #9）', () => {
    const inactive = AccountSchema.parse({
      kind: 'smbc_bank',
      common: {
        ...baseCommon,
        activeness: {
          kind: 'inactive',
          inactivatedAt: new Date('2026-05-01'),
          reason: '解約済み',
        },
      },
      balance: {
        currentBalance: 100000 as never,
        initialBalance: 100000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as SmbcBankAccount

    expect(() => applySmbcBalanceChange(inactive, 1000 as never, new Date('2026-05-26'))).toThrow(
      InvariantViolationError,
    )
  })
})

// --- #388: 引落消込の残高反映（同一通知の再反映を口座側で拒否する） ---

describe('applyUnpaidSettlementToSmbcBalance()', () => {
  const smbcAccount = () =>
    AccountSchema.parse({
      kind: 'smbc_bank',
      common: baseCommon,
      balance: {
        currentBalance: 100000 as never,
        initialBalance: 100000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as SmbcBankAccount

  const NOTICE = 'notice_202605' as never
  const at = new Date('2026-05-26')

  it('この項目を持たない既存データは未反映（空）として読み出される', () => {
    expect(smbcAccount().balance.appliedSettlementNoticeIds).toEqual([])
  })

  it('消込合計だけ残高を減算し、反映元の引落確定通知IDを記録する', () => {
    const updated = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })

    expect(updated.balance.currentBalance).toBe(92000)
    expect(updated.balance.appliedSettlementNoticeIds).toEqual(['notice_202605'])
    expect(updated.balance.lastUpdatedAt).toEqual(at)
  })

  it('同一の引落確定通知で2回目の反映は UnpaidSettlementAlreadyAppliedError（冪等性）', () => {
    const once = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })

    expect(() =>
      applyUnpaidSettlementToSmbcBalance(once, {
        settlementNoticeId: NOTICE,
        settledTotal: 8000 as never,
        at: new Date('2026-05-27'),
      }),
    ).toThrow(UnpaidSettlementAlreadyAppliedError)
  })

  it('3回以上再実行しても残高は1回分しか減らない', () => {
    const once = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })

    // 呼び出し側（ハンドラー）が「反映済みなら現状維持」とする挙動を再現する
    let current = once
    for (let i = 0; i < 3; i++) {
      try {
        current = applyUnpaidSettlementToSmbcBalance(current, {
          settlementNoticeId: NOTICE,
          settledTotal: 8000 as never,
          at: new Date('2026-05-27'),
        })
      } catch (e) {
        if (!(e instanceof UnpaidSettlementAlreadyAppliedError)) throw e
      }
    }

    expect(current.balance.currentBalance).toBe(92000)
  })

  it('別の引落確定通知なら反映でき、記録が最新のものへ更新される', () => {
    const may = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })
    const june = applyUnpaidSettlementToSmbcBalance(may, {
      settlementNoticeId: 'notice_202606' as never,
      settledTotal: 2000 as never,
      at: new Date('2026-06-26'),
    })

    expect(june.balance.currentBalance).toBe(90000)
    expect(june.balance.appliedSettlementNoticeIds).toEqual(['notice_202605', 'notice_202606'])
  })

  it('別の通知を反映した後に古い通知を再実行しても、残高は減らない', () => {
    // 記録が「最後の1件」だけだとここを素通りし、5月分がもう一度減算される
    // （メール再取込で過去の通知が古い順に再発行される経路）
    const may = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })
    const june = applyUnpaidSettlementToSmbcBalance(may, {
      settlementNoticeId: 'notice_202606' as never,
      settledTotal: 2000 as never,
      at: new Date('2026-06-26'),
    })

    expect(() =>
      applyUnpaidSettlementToSmbcBalance(june, {
        settlementNoticeId: NOTICE,
        settledTotal: 8000 as never,
        at: new Date('2026-06-27'),
      }),
    ).toThrow(UnpaidSettlementAlreadyAppliedError)
  })

  it('通常の入出金反映（applySmbcBalanceChange）を挟んでも反映済みの記録は保たれる', () => {
    // 記録が落ちると同じ通知を再反映できてしまい、#388 が潰した二重減算が再発する
    const applied = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })
    const afterDeposit = applySmbcBalanceChange(applied, 30000 as never, new Date('2026-05-28'))

    expect(afterDeposit.balance.appliedSettlementNoticeIds).toEqual(['notice_202605'])
    expect(() =>
      applyUnpaidSettlementToSmbcBalance(afterDeposit, {
        settlementNoticeId: NOTICE,
        settledTotal: 8000 as never,
        at: new Date('2026-05-29'),
      }),
    ).toThrow(UnpaidSettlementAlreadyAppliedError)
  })

  it('消込合計が 0 円でも通知は反映済みとして記録される（以後この通知では減算しない）', () => {
    const applied = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 0 as never,
      at,
    })

    expect(applied.balance.currentBalance).toBe(100000)
    expect(applied.balance.appliedSettlementNoticeIds).toEqual(['notice_202605'])
  })

  it('回復（遅れて古い通知を適用する）でも最終更新日時は巻き戻さない', () => {
    // この値は家計分析の残高鮮度評価に借用されるため、巻き戻すと残高が実際より古く見える
    const recent = applySmbcBalanceChange(
      smbcAccount(),
      30000 as never,
      new Date('2026-06-10T00:00:00Z'),
    )
    const recovered = applyUnpaidSettlementToSmbcBalance(recent, {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at: new Date('2026-05-26T00:00:00Z'), // 6月の入金より古い5月の通知
    })

    expect(recovered.balance.currentBalance).toBe(122000)
    expect(recovered.balance.lastUpdatedAt).toEqual(new Date('2026-06-10T00:00:00Z'))
  })

  it('非アクティブ口座へは反映できない（applySmbcBalanceChange の不変条件を引き継ぐ）', () => {
    const inactive = AccountSchema.parse({
      kind: 'smbc_bank',
      common: {
        ...baseCommon,
        activeness: { kind: 'inactive', inactivatedAt: new Date('2026-05-01'), reason: '解約済み' },
      },
      balance: {
        currentBalance: 100000 as never,
        initialBalance: 100000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as SmbcBankAccount

    expect(() =>
      applyUnpaidSettlementToSmbcBalance(inactive, {
        settlementNoticeId: NOTICE,
        settledTotal: 8000 as never,
        at,
      }),
    ).toThrow(InvariantViolationError)
  })
})

describe('applyOtherSavingsBalanceChange()', () => {
  const registeredAt = new Date('2026-07-01T00:00:00Z')
  const at = new Date('2026-07-25T03:00:00Z')
  const register = () =>
    registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000002' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 500000 as never,
      at: registeredAt,
    })

  it('SMBC からの振込（シャドウ残高加算）で現在残高が増える', () => {
    const updated = applyOtherSavingsBalanceChange(register(), 50000 as never, at)
    expect(updated.balance.currentBalance).toBe(550000)
  })

  it('別銀行戻し（負の delta）で現在残高が減る', () => {
    const updated = applyOtherSavingsBalanceChange(register(), -30000 as never, at)
    expect(updated.balance.currentBalance).toBe(470000)
  })

  it('残高鮮度の根拠も同じ時刻へ進む（更新済みなのに古いと表示されないようにする）', () => {
    const updated = applyOtherSavingsBalanceChange(register(), 50000 as never, at)
    expect(updated.balance.lastUpdatedAt).toEqual(at)
    expect(updated.freshnessSource.lastUpdatedAt).toEqual(at)
  })

  it('初期残高は書き換わらない（初期残高基準時刻も据え置き）', () => {
    const updated = applyOtherSavingsBalanceChange(register(), 50000 as never, at)
    expect(updated.balance.initialBalance).toBe(500000)
    expect(updated.balance.initialBalanceBaselineAt).toEqual(registeredAt)
  })

  it('非アクティブ口座へは適用できない', () => {
    const inactive = AccountSchema.parse({
      ...register(),
      common: {
        ...register().common,
        activeness: { kind: 'inactive', inactivatedAt: new Date('2026-07-10'), reason: '解約済み' },
      },
    }) as OtherSavingsAccount

    expect(() => applyOtherSavingsBalanceChange(inactive, 50000 as never, at)).toThrow(
      InvariantViolationError,
    )
  })
})

describe('applyOtherSavingsMovement()', () => {
  const registeredAt = new Date('2026-07-01T00:00:00Z')
  const at = new Date('2026-07-25T03:00:00Z')
  const TX_A = '01TXN000000000000000000001' as never
  const TX_B = '01TXN000000000000000000002' as never
  const register = () =>
    registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000002' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 500000 as never,
      at: registeredAt,
    })

  it('取引由来の加算が反映され、適用元の取引IDが記録される', () => {
    const updated = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: 50000 as never,
      at,
    })
    expect(updated.balance.currentBalance).toBe(550000)
    expect(updated.balance.appliedMovementTransactionIds).toEqual([TX_A])
  })

  it('同一取引の二度目は OtherSavingsMovementAlreadyAppliedError（残高が二重に動かない）', () => {
    const once = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: -30000 as never,
      at,
    })
    expect(() =>
      applyOtherSavingsMovement(once, { transactionId: TX_A, delta: -30000 as never, at }),
    ).toThrow(OtherSavingsMovementAlreadyAppliedError)
    expect(once.balance.currentBalance).toBe(470000)
  })

  it('別の取引は続けて反映でき、適用元が積み上がる', () => {
    const first = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: 50000 as never,
      at,
    })
    const second = applyOtherSavingsMovement(first, {
      transactionId: TX_B,
      delta: -20000 as never,
      at,
    })
    expect(second.balance.currentBalance).toBe(530000)
    expect(second.balance.appliedMovementTransactionIds).toEqual([TX_A, TX_B])
  })

  it('先に適用した取引が後から再送されても拒否される（集合で持つため）', () => {
    const first = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: 50000 as never,
      at,
    })
    const second = applyOtherSavingsMovement(first, {
      transactionId: TX_B,
      delta: -20000 as never,
      at,
    })
    expect(() =>
      applyOtherSavingsMovement(second, { transactionId: TX_A, delta: 50000 as never, at }),
    ).toThrow(OtherSavingsMovementAlreadyAppliedError)
  })

  it('遅れて古い移動を適用しても最終更新日時は巻き戻らない（回復時に残高が古く見えない）', () => {
    const recent = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: 50000 as never,
      at,
    })
    const late = applyOtherSavingsMovement(recent, {
      transactionId: TX_B,
      delta: 10000 as never,
      at: new Date('2026-07-10T00:00:00Z'),
    })
    expect(late.balance.currentBalance).toBe(560000)
    expect(late.balance.lastUpdatedAt).toEqual(at)
    expect(late.freshnessSource.lastUpdatedAt).toEqual(at)
  })

  it('残高を超える戻しでシャドウ残高は負になる（取込ラグで一時的に起こりうる）', () => {
    const small = registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000003' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 100000 as never,
      at: registeredAt,
    })
    const updated = applyOtherSavingsMovement(small, {
      transactionId: TX_A,
      delta: -300000 as never,
      at,
    })
    expect(updated.balance.currentBalance).toBe(-200000)
  })

  it('非アクティブ口座へは適用できない', () => {
    const inactive = AccountSchema.parse({
      ...register(),
      common: {
        ...register().common,
        activeness: { kind: 'inactive', inactivatedAt: new Date('2026-07-10'), reason: '解約済み' },
      },
    }) as OtherSavingsAccount

    expect(() =>
      applyOtherSavingsMovement(inactive, { transactionId: TX_A, delta: 50000 as never, at }),
    ).toThrow(InvariantViolationError)
  })

  it('既存データ（適用元の記録を持たない payload）は空配列として読み出される', () => {
    const legacy = AccountSchema.parse({
      kind: 'other_savings',
      common: register().common,
      bankName: '楽天銀行',
      balance: {
        currentBalance: 500000,
        initialBalance: 500000,
        initialBalanceBaselineAt: registeredAt,
        lastUpdatedAt: registeredAt,
      },
      freshnessSource: { lastUpdatedAt: registeredAt },
    }) as OtherSavingsAccount
    expect(legacy.balance.appliedMovementTransactionIds).toEqual([])
  })
})
