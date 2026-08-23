import { describe, it, expect } from 'vitest'
import {
  determineBankDepositPurpose,
  determineBankDepositPurposeForUser,
  determineWithdrawalPurpose,
} from '../../../src/balance-asset-tracking/services/determineBankDepositPurpose'
import {
  emptyEmployerRemitterDirectory,
  registerEmployerRemitterFromDeposit,
  type EmployerRemitterDirectory,
} from '../../../src/balance-asset-tracking/aggregates/EmployerRemitterDirectory'
import {
  recordBankDeposit,
  type DeterminedBankDeposit,
} from '../../../src/balance-asset-tracking/aggregates/BankDeposit'
import {
  DEFAULT_SALARY_PAYOUT_DAY_WINDOW,
  DEFAULT_SALARY_THRESHOLD_AMOUNT,
  bankDepositPurposeRule,
} from '../../../src/balance-asset-tracking/value-objects/BankDepositPurposeRule'
import { money } from '../../../src/shared/value-objects/Money'

const EMPLOYER = '振込サービス ｶ)ﾜﾘﾏﾙｼｮｳｼﾞ'
const SAVINGS_BANK = 'ﾖｿﾞﾗ銀行'

const rule = bankDepositPurposeRule({
  employerRemitterNames: [EMPLOYER],
  otherSavingsCounterpartyNames: [SAVINGS_BANK],
})

/** JST の指定日 12:00 を UTC の Date で表す（JST = UTC+9） */
function jstNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0))
}

/** JST のその日の 00:00 ちょうど（UTC では前日 15:00）。暦日境界の検証に使う */
function jstMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day - 1, 15, 0, 0))
}

describe('determineBankDepositPurpose（OQ-21: 入金日 + 金額の 2 シグナル）', () => {
  describe('2 シグナルが一致したとき自動確定する', () => {
    it('基準日以降 かつ 閾値以上 → 給与判別', () => {
      const result = determineBankDepositPurpose(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 31), remitterName: EMPLOYER },
        rule,
      )
      expect(result).toEqual({ kind: 'salary' })
    })

    it('基準日より前 かつ 閾値未満 → 経費精算入金判別', () => {
      const result = determineBankDepositPurpose(
        { amount: money(35_000), occurredAt: jstNoon(2026, 7, 15), remitterName: EMPLOYER },
        rule,
      )
      expect(result).toEqual({ kind: 'expense_reimbursement' })
    })
  })

  describe('2 シグナルが矛盾したとき自動確定せず手動確認へ倒す（OQ-21 ③）', () => {
    it('基準日より前 かつ 閾値以上（月内上中旬の大型立替 or 給与前倒し）→ 用途不明', () => {
      const result = determineBankDepositPurpose(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 10), remitterName: EMPLOYER },
        rule,
      )
      expect(result).toEqual({
        kind: 'unknown',
        provisionalHandling: 'awaiting_manual_confirmation',
      })
    })

    it('基準日以降 かつ 閾値未満 → 用途不明', () => {
      const result = determineBankDepositPurpose(
        { amount: money(35_000), occurredAt: jstNoon(2026, 7, 25), remitterName: EMPLOYER },
        rule,
      )
      expect(result.kind).toBe('unknown')
    })

    it('旧ルール（25 万円以上は給与とみなす）へは戻さない', () => {
      // 金額だけで倒すと、経費精算入金を給与と誤判定した月は突合が発火せず
      // 月次レポートが最終確定へ昇格しなくなる（OQ-21 の改訂理由）
      const result = determineBankDepositPurpose(
        { amount: money(250_000), occurredAt: jstNoon(2026, 7, 5), remitterName: EMPLOYER },
        rule,
      )
      expect(result).toEqual({
        kind: 'unknown',
        provisionalHandling: 'awaiting_manual_confirmation',
      })
    })
  })

  describe('入金日シグナルの境界（月内基準日 = 21 日）', () => {
    it('既定の月内基準日は 21 日', () => {
      expect(DEFAULT_SALARY_PAYOUT_DAY_WINDOW).toBe(21)
    })

    it('20 日（基準日の 1 日前）は経費精算寄り', () => {
      const result = determineBankDepositPurpose(
        { amount: money(35_000), occurredAt: jstNoon(2026, 7, 20), remitterName: EMPLOYER },
        rule,
      )
      expect(result.kind).toBe('expense_reimbursement')
    })

    it('21 日ちょうどは給与寄り（基準日を含む）', () => {
      const result = determineBankDepositPurpose(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 21), remitterName: EMPLOYER },
        rule,
      )
      expect(result.kind).toBe('salary')
    })

    it('21 日ちょうど かつ 閾値未満は矛盾なので用途不明', () => {
      const result = determineBankDepositPurpose(
        { amount: money(35_000), occurredAt: jstNoon(2026, 7, 21), remitterName: EMPLOYER },
        rule,
      )
      expect(result.kind).toBe('unknown')
    })

    it('JST 21 日 00:00 の入金は 21 日として扱う（UTC で読むと 20 日にずれる）', () => {
      const at = jstMidnight(2026, 7, 21)
      expect(at.toISOString()).toBe('2026-07-20T15:00:00.000Z')
      const result = determineBankDepositPurpose(
        { amount: money(300_000), occurredAt: at, remitterName: EMPLOYER },
        rule,
      )
      expect(result.kind).toBe('salary')
    })

    it('月内基準日はルールで上書きできる', () => {
      const customRule = bankDepositPurposeRule({
        employerRemitterNames: [EMPLOYER],
        salaryPayoutDayWindow: 25,
      })
      const result = determineBankDepositPurpose(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 21), remitterName: EMPLOYER },
        customRule,
      )
      // 基準日が 25 日なら 21 日は経費精算寄り → 金額シグナル（給与寄り）と矛盾
      expect(result.kind).toBe('unknown')
    })
  })

  describe('金額シグナルの境界（給与判別閾値 = 25 万円）', () => {
    it('既定の閾値は 25 万円', () => {
      expect(DEFAULT_SALARY_THRESHOLD_AMOUNT).toBe(250_000)
    })

    it('249,999 円（閾値の 1 円下）は経費精算寄り', () => {
      const result = determineBankDepositPurpose(
        { amount: money(249_999), occurredAt: jstNoon(2026, 7, 15), remitterName: EMPLOYER },
        rule,
      )
      expect(result.kind).toBe('expense_reimbursement')
    })

    it('250,000 円ちょうどは給与寄り（閾値を含む）', () => {
      const result = determineBankDepositPurpose(
        { amount: money(250_000), occurredAt: jstNoon(2026, 7, 31), remitterName: EMPLOYER },
        rule,
      )
      expect(result.kind).toBe('salary')
    })
  })

  describe('別銀行戻し判別（振込元名パターン）', () => {
    it('別銀行貯蓄口座からの入金は、日付・金額に関わらず別銀行戻し', () => {
      const result = determineBankDepositPurpose(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 31), remitterName: SAVINGS_BANK },
        rule,
      )
      expect(result).toEqual({ kind: 'other_savings_return' })
    })
  })

  describe('振込元名の正規化（OQ-7）', () => {
    it('全角・空白ゆれがあっても勤務先として照合できる', () => {
      const result = determineBankDepositPurpose(
        {
          amount: money(300_000),
          occurredAt: jstNoon(2026, 7, 31),
          remitterName: '振込サービス　ｶ)ﾜﾘﾏﾙｼｮｳｼﾞ  ',
        },
        rule,
      )
      expect(result.kind).toBe('salary')
    })

    it('カタカナ直後のハイフン類は長音へ寄せて照合する', () => {
      const choonRule = bankDepositPurposeRule({ employerRemitterNames: ['ワリマールショウジ'] })
      const result = determineBankDepositPurpose(
        {
          amount: money(300_000),
          occurredAt: jstNoon(2026, 7, 31),
          remitterName: 'ワリマ−ルショウジ',
        },
        choonRule,
      )
      expect(result.kind).toBe('salary')
    })
  })

  describe('どのパターンにも当たらない振込元', () => {
    it('見知らぬ振込元からの入金は用途不明（勝手に給与や経費精算にしない）', () => {
      const result = determineBankDepositPurpose(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 31), remitterName: 'ﾌﾒｲﾅﾌﾘｺﾐﾓﾄ' },
        rule,
      )
      expect(result).toEqual({
        kind: 'unknown',
        provisionalHandling: 'awaiting_manual_confirmation',
      })
    })
  })
})

describe('determineWithdrawalPurpose', () => {
  it('別銀行貯蓄口座あての振込は別銀行振込用（シャドウ残高加算の対象）', () => {
    expect(
      determineWithdrawalPurpose(
        { counterpartyName: SAVINGS_BANK },
        rule.otherSavingsCounterpartyNames,
      ),
    ).toBe('other_savings_transfer')
  })

  it('表記ゆれがあっても別銀行貯蓄口座として照合できる', () => {
    expect(
      determineWithdrawalPurpose(
        { counterpartyName: 'ヨゾラ銀行 ' },
        rule.otherSavingsCounterpartyNames,
      ),
    ).toBe('other_savings_transfer')
  })

  it('それ以外の振込先はその他出金（勝手にシャドウ残高を動かさない）', () => {
    expect(
      determineWithdrawalPurpose(
        { counterpartyName: 'ﾄﾞｺｶﾉｵﾐｾ' },
        rule.otherSavingsCounterpartyNames,
      ),
    ).toBe('other')
  })
})

describe('BankDepositPurposeRule のスキーマ制約', () => {
  it('勤務先振込元名が空だと組み立てられない（全入金が用途不明に落ちるため）', () => {
    expect(() => bankDepositPurposeRule({ employerRemitterNames: [] })).toThrow()
  })

  it.each([1, 28])('月内基準日 %i 日は許容される（全月で成立する範囲）', day => {
    expect(
      bankDepositPurposeRule({ employerRemitterNames: [EMPLOYER], salaryPayoutDayWindow: day })
        .salaryPayoutDayWindow,
    ).toBe(day)
  })

  it.each([0, 29])('月内基準日 %i 日は許さない（月末日に依らず全月で成立する範囲に限る）', day => {
    expect(() =>
      bankDepositPurposeRule({ employerRemitterNames: [EMPLOYER], salaryPayoutDayWindow: day }),
    ).toThrow()
  })

  it('給与判別閾値金額は 0 円以下を許さない（金額シグナルが機能しなくなるため）', () => {
    expect(() =>
      bankDepositPurposeRule({
        employerRemitterNames: [EMPLOYER],
        salaryThresholdAmount: money(0),
      }),
    ).toThrow()
  })

  it('パターンは登録時に正規化される（未正規化の値が入ると恒久的に照合できなくなる）', () => {
    const built = bankDepositPurposeRule({ employerRemitterNames: ['ワリマ−ル  ショウジ'] })
    expect(built.employerRemitterNames).toEqual(['ワリマール ショウジ'])
  })
})

describe('determineBankDepositPurposeForUser（勤務先振込元名簿を入口にする、#448 / OQ-61）', () => {
  const OWNER = 'user_honey' as never
  const at = new Date('2026-07-21T03:00:00Z')

  /** 名簿に勤務先を 1 件登録した状態を作る */
  function directoryWithEmployer(): EmployerRemitterDirectory {
    return registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
      deposit: recordBankDeposit({
        common: {
          bankDepositId: '01BDP000000000000000000001' as never,
          accountId: '01ACC000000000000000000001' as never,
          transactionId: '01TXN000000000000000000001' as never,
          userId: OWNER,
          amount: 300_000 as never,
          occurredAt: at,
          remitterName: EMPLOYER,
          determinedAt: at,
        },
        purpose: { kind: 'salary' },
        expenseReimbursementId: '01EXR000000000000000000001' as never,
      }) as DeterminedBankDeposit,
      operatorUserId: OWNER,
      at,
    })
  }

  it('登録済みの勤務先からの入金は 2 シグナルで自動確定する', () => {
    expect(
      determineBankDepositPurposeForUser(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 31), remitterName: EMPLOYER },
        directoryWithEmployer(),
      ),
    ).toEqual({ kind: 'salary' })
  })

  it('名簿の表記ゆれを吸収して照合する（登録時と明細の表記が違っても効く）', () => {
    expect(
      determineBankDepositPurposeForUser(
        {
          amount: money(35_000),
          occurredAt: jstNoon(2026, 7, 15),
          remitterName: '振込サービス　カ)ワリマルショウジ',
        },
        directoryWithEmployer(),
      ),
    ).toEqual({ kind: 'expense_reimbursement' })
  })

  it('名簿が空なら勤務先からの入金でも用途不明（最初の 1 件は必ず手動確認を通る）', () => {
    expect(
      determineBankDepositPurposeForUser(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 31), remitterName: EMPLOYER },
        emptyEmployerRemitterDirectory(OWNER),
      ),
    ).toEqual({ kind: 'unknown', provisionalHandling: 'awaiting_manual_confirmation' })
  })

  it('勤務先を登録済みでも別銀行貯蓄口座からの戻しは戻しとして判別する', () => {
    expect(
      determineBankDepositPurposeForUser(
        { amount: money(100_000), occurredAt: jstNoon(2026, 7, 31), remitterName: SAVINGS_BANK },
        directoryWithEmployer(),
        { otherSavingsCounterpartyNames: [SAVINGS_BANK] },
      ),
    ).toEqual({ kind: 'other_savings_return' })
  })

  it.each([
    ['給与判別閾値金額が 0 円', { salaryThresholdAmount: money(0) }],
    ['月内基準日が 0 日', { salaryPayoutDayWindow: 0 }],
  ])('名簿が空でも %s のような不正な判別条件は受け付けない', (_label, ruleOptions) => {
    // 名簿の中身次第で通ったり落ちたりすると、勤務先を 1 件登録した瞬間に初めて壊れる
    expect(() =>
      determineBankDepositPurposeForUser(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 31), remitterName: EMPLOYER },
        emptyEmployerRemitterDirectory(OWNER),
        ruleOptions,
      ),
    ).toThrow()
  })

  it('名簿が空でも別銀行貯蓄口座からの戻しは判別できる（勤務先名に依存しないため）', () => {
    expect(
      determineBankDepositPurposeForUser(
        { amount: money(100_000), occurredAt: jstNoon(2026, 7, 31), remitterName: SAVINGS_BANK },
        emptyEmployerRemitterDirectory(OWNER),
        { otherSavingsCounterpartyNames: [SAVINGS_BANK] },
      ),
    ).toEqual({ kind: 'other_savings_return' })
  })

  it('名簿に載っていない振込元は用途不明のまま（他人の勤務先を勝手に判別しない）', () => {
    expect(
      determineBankDepositPurposeForUser(
        { amount: money(300_000), occurredAt: jstNoon(2026, 7, 31), remitterName: 'ﾄﾞｺｶﾉｶｲｼｬ' },
        directoryWithEmployer(),
      ),
    ).toEqual({ kind: 'unknown', provisionalHandling: 'awaiting_manual_confirmation' })
  })

  it('世帯共通の判別条件（基準日・閾値）は呼び出し側の指定が効く', () => {
    expect(
      determineBankDepositPurposeForUser(
        { amount: money(120_000), occurredAt: jstNoon(2026, 7, 15), remitterName: EMPLOYER },
        directoryWithEmployer(),
        { salaryPayoutDayWindow: 10, salaryThresholdAmount: money(100_000) },
      ),
    ).toEqual({ kind: 'salary' })
  })
})
