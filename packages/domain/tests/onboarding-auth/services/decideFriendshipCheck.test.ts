/**
 * 友だち追加の確認（照会の要否と照会結果の写像。#417 / OQ-55 ②③）
 *
 * 08f「LINE友達状態を照会する」の 2 つの規則
 *  - LINE_友達追加状態 = 未追加 のときだけ照会する
 *  - 照会不能 は 友達未追加 と区別する
 * を固定する。ここが緩むと、通信断や API 障害を根拠に「友だち未追加」を確定させ、実際は
 * 友だち追加済みの人が通知の設定へ進めないまま残る。
 */
import { describe, it, expect } from 'vitest'
import {
  recordLineFriendAdded,
  registerAppUser,
} from '../../../src/onboarding-auth/aggregates/AppUser'
import {
  friendshipCheckOutcomeOf,
  requiresFriendshipCheck,
} from '../../../src/onboarding-auth/services/decideFriendshipCheck'

const AT = new Date('2026-08-22T00:00:00Z')
const notAdded = (): ReturnType<typeof registerAppUser> =>
  registerAppUser('line_user_honey' as never, 'honey', undefined, AT)

describe('requiresFriendshipCheck', () => {
  it('友だち追加が未記録なら照会が要る', () => {
    expect(requiresFriendshipCheck(notAdded())).toBe(true)
  })

  // 記録済みなら照会しても記録は変わらない。利用者が確認を繰り返しても外部 API を叩き続けない
  it('友だち追加が記録済みなら照会は要らない', () => {
    expect(requiresFriendshipCheck(recordLineFriendAdded(notAdded(), AT))).toBe(false)
  })
})

describe('friendshipCheckOutcomeOf', () => {
  it('友だちなら確認済みになる', () => {
    expect(friendshipCheckOutcomeOf({ kind: 'friend' })).toBe('confirmed')
  })

  it('友だちでなければ友だち未追加になる', () => {
    expect(friendshipCheckOutcomeOf({ kind: 'not_friend' })).toBe('not_friend')
  })

  // 照会不能を友だち未追加へ丸めない。丸めると障害を根拠に未追加を確定させ、
  // 要求元が「LINE で友だち追加する」と「やり直す」を出し分けられなくなる
  it('照会できなかった場合は友だち未追加と区別される', () => {
    expect(friendshipCheckOutcomeOf({ kind: 'unknown', detail: 'LINE profile API 500' })).toBe(
      'unavailable',
    )
  })
})
