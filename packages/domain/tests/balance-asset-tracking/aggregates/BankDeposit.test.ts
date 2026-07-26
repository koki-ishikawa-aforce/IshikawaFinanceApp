import { describe, it, expect } from 'vitest'
import {
  BankDepositSchema,
  confirmBankDepositPurpose,
  isDeterminedBankDeposit,
  recordBankDeposit,
  type BankDeposit,
  type CommonBankDepositAttrs,
} from '../../../src/balance-asset-tracking/aggregates/BankDeposit'
import {
  InvariantViolationError,
  PermissionDeniedError,
} from '../../../src/shared/errors/DomainError'

const OWNER = 'user_honey' as never
const SPOUSE = 'user_darling' as never
const REIMBURSEMENT_ID = '01EXR000000000000000000001' as never
const OTHER_REIMBURSEMENT_ID = '01EXR000000000000000000002' as never

const determinedAt = new Date('2026-07-21T03:00:00Z')

const common: CommonBankDepositAttrs = {
  bankDepositId: '01BDP000000000000000000001' as never,
  accountId: '01ACC000000000000000000001' as never,
  transactionId: '01TXN000000000000000000001' as never,
  userId: OWNER,
  amount: 300_000 as never,
  occurredAt: new Date('2026-07-21T02:00:00Z'),
  remitterName: '振込サービス ｶ)ﾜﾘﾏﾙｼｮｳｼﾞ',
  determinedAt,
}

function record(purpose: Parameters<typeof recordBankDeposit>[0]['purpose']): BankDeposit {
  return recordBankDeposit({ common, purpose, expenseReimbursementId: REIMBURSEMENT_ID })
}

describe('BankDeposit 集約', () => {
  describe('recordBankDeposit（判別結果の組み立て）', () => {
    it('給与判別は自動確定として記録される', () => {
      const deposit = record('salary')
      expect(deposit).toEqual({ kind: 'salary', common, determinationSource: 'automatic' })
    })

    it('経費精算入金判別は経費精算入金ID を伴う（08d §1）', () => {
      const deposit = record('expense_reimbursement')
      expect(deposit).toMatchObject({
        kind: 'expense_reimbursement',
        expenseReimbursementId: REIMBURSEMENT_ID,
        determinationSource: 'automatic',
      })
    })

    it('給与判別には経費精算入金ID を持ち込まない', () => {
      expect(record('salary')).not.toHaveProperty('expenseReimbursementId')
    })

    it('用途不明は暫定処理「手動確認待ち」を伴う', () => {
      expect(record('unknown')).toEqual({
        kind: 'unknown',
        common,
        provisionalHandling: 'awaiting_manual_confirmation',
      })
    })
  })

  describe('不変条件: 入金金額は正', () => {
    it.each([0, -1])('%i 円の入金は組み立てられない', amount => {
      expect(() =>
        recordBankDeposit({
          common: { ...common, amount: amount as never },
          purpose: 'salary',
          expenseReimbursementId: REIMBURSEMENT_ID,
        }),
      ).toThrow()
    })
  })

  describe('confirmBankDepositPurpose（用途不明 → 確定）', () => {
    it('本人が用途を確定でき、手動確定として記録される', () => {
      const confirmedAt = new Date('2026-07-22T01:00:00Z')
      const confirmed = confirmBankDepositPurpose(record('unknown'), {
        purpose: 'salary',
        operatorUserId: OWNER,
        expenseReimbursementId: REIMBURSEMENT_ID,
        at: confirmedAt,
      })
      expect(confirmed.kind).toBe('salary')
      expect(confirmed.determinationSource).toBe('manual')
      expect(confirmed.common.determinedAt).toEqual(confirmedAt)
    })

    it('経費精算入金として確定すると経費精算入金ID が採番される', () => {
      const confirmed = confirmBankDepositPurpose(record('unknown'), {
        purpose: 'expense_reimbursement',
        operatorUserId: OWNER,
        expenseReimbursementId: REIMBURSEMENT_ID,
        at: determinedAt,
      })
      expect(confirmed).toMatchObject({
        kind: 'expense_reimbursement',
        expenseReimbursementId: REIMBURSEMENT_ID,
      })
    })

    it('確定しても入金の金額・取引ID は書き換わらない', () => {
      const confirmed = confirmBankDepositPurpose(record('unknown'), {
        purpose: 'other_savings_return',
        operatorUserId: OWNER,
        expenseReimbursementId: REIMBURSEMENT_ID,
        at: determinedAt,
      })
      expect(confirmed.common.amount).toBe(common.amount)
      expect(confirmed.common.transactionId).toBe(common.transactionId)
    })

    describe('否定形: 配偶者は確定できない（プライバシー3段階ルール）', () => {
      it('配偶者が確定しようとすると PermissionDeniedError', () => {
        expect(() =>
          confirmBankDepositPurpose(record('unknown'), {
            purpose: 'salary',
            operatorUserId: SPOUSE,
            expenseReimbursementId: REIMBURSEMENT_ID,
            at: determinedAt,
          }),
        ).toThrow(PermissionDeniedError)
      })

      it('所有者判定は用途の確定可否より先に効く（確定済みでも他人には権限エラー）', () => {
        expect(() =>
          confirmBankDepositPurpose(record('salary'), {
            purpose: 'salary',
            operatorUserId: SPOUSE,
            expenseReimbursementId: REIMBURSEMENT_ID,
            at: determinedAt,
          }),
        ).toThrow(PermissionDeniedError)
      })
    })

    describe('否定形: 一方向遷移（確定済みは変更できない）', () => {
      it.each(['salary', 'expense_reimbursement', 'other_savings_return'] as const)(
        '%s で確定済みの入金は用途を変更できない',
        purpose => {
          expect(() =>
            confirmBankDepositPurpose(record(purpose), {
              purpose: 'other_savings_return',
              operatorUserId: OWNER,
              expenseReimbursementId: OTHER_REIMBURSEMENT_ID,
              at: determinedAt,
            }),
          ).toThrow(InvariantViolationError)
        },
      )

      it('同じ用途で確定し直すこともできない（二重反映の余地を残さない）', () => {
        expect(() =>
          confirmBankDepositPurpose(record('other_savings_return'), {
            purpose: 'other_savings_return',
            operatorUserId: OWNER,
            expenseReimbursementId: REIMBURSEMENT_ID,
            at: determinedAt,
          }),
        ).toThrow(InvariantViolationError)
      })
    })
  })

  describe('isDeterminedBankDeposit', () => {
    it('用途不明だけが未確定', () => {
      expect(isDeterminedBankDeposit(record('unknown'))).toBe(false)
      expect(isDeterminedBankDeposit(record('salary'))).toBe(true)
      expect(isDeterminedBankDeposit(record('expense_reimbursement'))).toBe(true)
      expect(isDeterminedBankDeposit(record('other_savings_return'))).toBe(true)
    })
  })

  describe('永続化からの復元', () => {
    it('経費精算入金ID の無い経費精算入金判別は parse できない（08d §1 の必須項目）', () => {
      expect(() =>
        BankDepositSchema.parse({
          kind: 'expense_reimbursement',
          common,
          determinationSource: 'automatic',
        }),
      ).toThrow()
    })

    it('未知の暫定処理は parse できない', () => {
      expect(() =>
        BankDepositSchema.parse({
          kind: 'unknown',
          common,
          provisionalHandling: 'auto_salary',
        }),
      ).toThrow()
    })
  })
})
