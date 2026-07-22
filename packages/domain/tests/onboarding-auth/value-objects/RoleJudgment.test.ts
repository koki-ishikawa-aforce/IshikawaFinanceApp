import { describe, it, expect } from 'vitest'
import { judgeRole } from '../../../src/onboarding-auth/value-objects/RoleJudgment'

const allowlist = {
  honeyLineUserId: 'line_user_honey' as never,
  darlingLineUserId: 'line_user_darling' as never,
}

describe('judgeRole（役割判定、08f §2）', () => {
  it('許可リストの Honey / Darling に一致すれば役割確定', () => {
    const at = new Date()
    const honey = judgeRole('line_user_honey' as never, allowlist, at)
    expect(honey).toEqual({
      kind: 'accepted',
      lineUserId: 'line_user_honey',
      role: 'honey',
      judgedAt: at,
    })

    const darling = judgeRole('line_user_darling' as never, allowlist, at)
    expect(darling.kind === 'accepted' && darling.role).toBe('darling')
  })

  it('どちらにも一致しなければ役割拒否（許可リスト不一致、P1-2）', () => {
    const at = new Date()
    const rejected = judgeRole('line_user_stranger' as never, allowlist, at)
    expect(rejected).toEqual({
      kind: 'rejected',
      lineUserId: 'line_user_stranger',
      rejectedAt: at,
      reason: 'allowlist_mismatch',
    })
  })
})
