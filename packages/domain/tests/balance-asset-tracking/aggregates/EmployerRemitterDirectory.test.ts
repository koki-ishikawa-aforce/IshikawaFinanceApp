import { describe, it, expect } from 'vitest'
import {
  canViewEmployerRemitterDirectory,
  emptyEmployerRemitterDirectory,
  employerRemitterNamesOf,
  isRegisteredEmployerRemitter,
  registerEmployerRemitterFromDeposit,
  EmployerRemitterDirectorySchema,
} from '../../../src/balance-asset-tracking/aggregates/EmployerRemitterDirectory'
import {
  recordBankDeposit,
  type CommonBankDepositAttrs,
  type DeterminedBankDeposit,
} from '../../../src/balance-asset-tracking/aggregates/BankDeposit'
import type { DepositPurpose } from '../../../src/balance-asset-tracking/value-objects/DepositPurpose'
import {
  InvariantViolationError,
  PermissionDeniedError,
} from '../../../src/shared/errors/DomainError'

const OWNER = 'user_honey' as never
const SPOUSE = 'user_darling' as never
const REIMBURSEMENT_ID = '01EXR000000000000000000001' as never

const EMPLOYER_RAW = '振込サービス ｶ)ﾜﾘﾏﾙｼｮｳｼﾞ'
/** 同じ勤務先の表記ゆれ（全角/半角・空白位置）。正規化して同一とみなす対象（OQ-7 / OQ-21） */
const EMPLOYER_VARIANT = '振込サービス　カ)ワリマルショウジ'

const at = new Date('2026-07-21T03:00:00Z')

function commonOf(overrides: Partial<CommonBankDepositAttrs> = {}): CommonBankDepositAttrs {
  return {
    bankDepositId: '01BDP000000000000000000001' as never,
    accountId: '01ACC000000000000000000001' as never,
    transactionId: '01TXN000000000000000000001' as never,
    userId: OWNER,
    amount: 300_000 as never,
    occurredAt: new Date('2026-07-21T02:00:00Z'),
    remitterName: EMPLOYER_RAW,
    determinedAt: at,
    ...overrides,
  }
}

function depositOf(
  kind: Exclude<DepositPurpose['kind'], 'unknown'>,
  overrides: Partial<CommonBankDepositAttrs> = {},
): DeterminedBankDeposit {
  return recordBankDeposit({
    common: commonOf(overrides),
    purpose: { kind },
    expenseReimbursementId: REIMBURSEMENT_ID,
  }) as DeterminedBankDeposit
}

describe('EmployerRemitterDirectory 集約（勤務先振込元名簿、#448 / OQ-61）', () => {
  describe('確定済み入金からの登録', () => {
    it('給与として確定した入金の振込元が名簿に載る', () => {
      const directory = registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
        deposit: depositOf('salary'),
        operatorUserId: OWNER,
        at,
      })

      expect(directory.entries).toEqual([
        {
          // 照合は正規化済みの名前で行う（表記ゆれを吸収する）
          normalizedName: '振込サービス カ)ワリマルショウジ',
          // 明細で見た表記をそのまま残す
          displayName: EMPLOYER_RAW,
          registeredAt: at,
          sourceTransactionId: '01TXN000000000000000000001',
        },
      ])
    })

    it('経費精算入金として確定した入金の振込元も登録できる（同じ勤務先から届くため）', () => {
      const directory = registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
        deposit: depositOf('expense_reimbursement'),
        operatorUserId: OWNER,
        at,
      })

      expect(employerRemitterNamesOf(directory)).toHaveLength(1)
    })

    it('別の勤務先を追加すると 2 件になる（転職・副業で複数の振込元がありうる）', () => {
      const first = registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
        deposit: depositOf('salary'),
        operatorUserId: OWNER,
        at,
      })
      const second = registerEmployerRemitterFromDeposit(first, {
        deposit: depositOf('salary', {
          remitterName: 'ｶ)ﾜﾘﾏﾙﾃｸﾉﾛｼﾞｰｽﾞ',
          transactionId: '01TXN000000000000000000002' as never,
        }),
        operatorUserId: OWNER,
        at: new Date('2026-08-21T03:00:00Z'),
      })

      expect(employerRemitterNamesOf(second)).toHaveLength(2)
    })
  })

  describe('再登録は冪等（確定のやり直しで記録が壊れない）', () => {
    it('同じ振込元を登録し直しても件数は増えない', () => {
      const once = registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
        deposit: depositOf('salary'),
        operatorUserId: OWNER,
        at,
      })
      const twice = registerEmployerRemitterFromDeposit(once, {
        deposit: depositOf('salary'),
        operatorUserId: OWNER,
        at: new Date('2026-09-21T03:00:00Z'),
      })

      expect(twice.entries).toHaveLength(1)
      // 登録日時は初回のまま（「いつ覚えたか」の記録を上書きしない）
      expect(twice.entries[0]?.registeredAt).toEqual(at)
    })

    it('表記ゆれの振込元は同じ勤務先とみなして増えない（正規化して照合する）', () => {
      const once = registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
        deposit: depositOf('salary'),
        operatorUserId: OWNER,
        at,
      })
      const twice = registerEmployerRemitterFromDeposit(once, {
        deposit: depositOf('salary', {
          remitterName: EMPLOYER_VARIANT,
          transactionId: '01TXN000000000000000000002' as never,
        }),
        operatorUserId: OWNER,
        at,
      })

      expect(twice.entries).toHaveLength(1)
      expect(twice.entries[0]?.displayName).toBe(EMPLOYER_RAW)
    })
  })

  describe('否定形', () => {
    it('配偶者は他人の名簿に勤務先を登録できない（プライバシー3段階ルール）', () => {
      expect(() =>
        registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
          deposit: depositOf('salary'),
          operatorUserId: SPOUSE,
          at,
        }),
      ).toThrow(PermissionDeniedError)
    })

    it('配偶者の入金の振込元を自分の名簿へ取り込めない', () => {
      expect(() =>
        registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
          deposit: depositOf('salary', { userId: SPOUSE }),
          operatorUserId: OWNER,
          at,
        }),
      ).toThrow(PermissionDeniedError)
    })

    it('別銀行戻しの振込元は勤務先として登録できない（自分の口座間の資金移動が給与になる）', () => {
      expect(() =>
        registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
          deposit: depositOf('other_savings_return'),
          operatorUserId: OWNER,
          at,
        }),
      ).toThrow(InvariantViolationError)
    })

    it('配偶者は名簿を閲覧できない', () => {
      const directory = emptyEmployerRemitterDirectory(OWNER)
      expect(canViewEmployerRemitterDirectory(directory, OWNER)).toBe(true)
      expect(canViewEmployerRemitterDirectory(directory, SPOUSE)).toBe(false)
    })

    it('正規化済みの名前が重複する名簿は組み立てられない', () => {
      const entry = {
        normalizedName: '振込サービス カ)ワリマルショウジ',
        displayName: EMPLOYER_RAW,
        registeredAt: at,
        sourceTransactionId: '01TXN000000000000000000001',
      }
      expect(() =>
        EmployerRemitterDirectorySchema.parse({ userId: OWNER, entries: [entry, entry] }),
      ).toThrow()
    })
  })

  describe('登録済み判定', () => {
    it('表記ゆれでも登録済みと判定する', () => {
      const directory = registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(OWNER), {
        deposit: depositOf('salary'),
        operatorUserId: OWNER,
        at,
      })

      expect(isRegisteredEmployerRemitter(directory, EMPLOYER_VARIANT)).toBe(true)
      expect(isRegisteredEmployerRemitter(directory, 'ﾖｿﾞﾗ銀行')).toBe(false)
    })

    it('空の名簿はどの振込元も登録済みではない', () => {
      expect(
        isRegisteredEmployerRemitter(emptyEmployerRemitterDirectory(OWNER), EMPLOYER_RAW),
      ).toBe(false)
    })
  })
})
