import { describe, it, expect } from 'vitest'
import {
  assertPersonalExpenseClassMatchesRole,
  roleToPersonalExpenseClass,
} from '../../../src/shared/value-objects/PersonalExpenseClass'
import { InvariantViolationError } from '../../../src/shared/errors'

describe('roleToPersonalExpenseClass', () => {
  it('honey → personal_honey / darling → personal_darling', () => {
    expect(roleToPersonalExpenseClass('honey')).toBe('personal_honey')
    expect(roleToPersonalExpenseClass('darling')).toBe('personal_darling')
  })
})

describe('assertPersonalExpenseClassMatchesRole（個人費用区分と所有者ロールの整合、C#11）', () => {
  it('所有者ロールと一致する個人費用区分は許容', () => {
    expect(() => assertPersonalExpenseClassMatchesRole('personal_honey', 'honey')).not.toThrow()
    expect(() => assertPersonalExpenseClassMatchesRole('personal_darling', 'darling')).not.toThrow()
  })

  it('相手の個人費用区分を付けると InvariantViolationError', () => {
    expect(() => assertPersonalExpenseClassMatchesRole('personal_honey', 'darling')).toThrow(
      InvariantViolationError,
    )
    expect(() => assertPersonalExpenseClassMatchesRole('personal_darling', 'honey')).toThrow(
      InvariantViolationError,
    )
  })

  it('世帯・経費(会社) は所有者ロールに縛られない（両ロールで許容）', () => {
    for (const role of ['honey', 'darling'] as const) {
      expect(() => assertPersonalExpenseClassMatchesRole('household', role)).not.toThrow()
      expect(() => assertPersonalExpenseClassMatchesRole('business_expense', role)).not.toThrow()
    }
  })
})
