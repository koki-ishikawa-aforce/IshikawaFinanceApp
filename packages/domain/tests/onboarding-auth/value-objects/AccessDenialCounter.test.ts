import { describe, it, expect } from 'vitest'
import { recordAccessDenial } from '../../../src/onboarding-auth/value-objects/AccessDenialCounter'

const STRANGER = 'line_user_stranger' as never
const OTHER_STRANGER = 'line_user_other_stranger' as never

describe('recordAccessDenial（アクセス拒否カウンタ、08f §1。Issue #651 決定 A-1）', () => {
  it('既存カウンタが無ければ1件目として作る', () => {
    const at = new Date('2026-08-28T10:00:00Z')
    const counter = recordAccessDenial(null, STRANGER, at)
    expect(counter).toEqual({ lineUserId: STRANGER, deniedCount: 1, lastDeniedAt: at })
  })

  it('既存カウンタがあれば累計回数を+1し、最終発生日時を更新する（個々の発生時刻の履歴は残さない）', () => {
    const first = new Date('2026-08-28T10:00:00Z')
    const second = new Date('2026-08-28T10:05:00Z')
    const initial = recordAccessDenial(null, STRANGER, first)
    const updated = recordAccessDenial(initial, STRANGER, second)
    expect(updated).toEqual({ lineUserId: STRANGER, deniedCount: 2, lastDeniedAt: second })
  })

  it('相手ごとに別カウンタになる（他の相手のカウンタを渡しても混ざらない、否定形）', () => {
    const at = new Date('2026-08-28T10:00:00Z')
    const otherCounter = recordAccessDenial(null, OTHER_STRANGER, at)
    const counter = recordAccessDenial(null, STRANGER, at)
    expect(counter.lineUserId).not.toBe(otherCounter.lineUserId)
    expect(counter.deniedCount).toBe(1)
  })
})
