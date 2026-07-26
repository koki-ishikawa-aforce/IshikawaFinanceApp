/**
 * join Webhook 由来の参加記録の可否判定（#371 / OQ-55 ①）
 *
 * 08f「join Webhook を受信する」の 2 つの事前条件（未参加である / 在籍照会結果 = 在籍あり）を
 * 状態 × 照会結果の表として固定する。ここが緩むと、家計サマリの配信先が第三者のトークルームに
 * 差し替わる（記録すると上書き禁止で固定され、以後は自己申告 API でしか直せない）。
 */
import { describe, it, expect } from 'vitest'
import {
  NOT_JOINED_SHARED_TALK_ROOM,
  recordSharedTalkRoomJoined,
} from '../../../src/onboarding-auth/aggregates/SharedTalkRoom'
import {
  decideSharedTalkRoomJoin,
  requiresTalkRoomMembershipCheck,
} from '../../../src/onboarding-auth/services/decideSharedTalkRoomJoin'

const joined = recordSharedTalkRoomJoined(
  NOT_JOINED_SHARED_TALK_ROOM,
  'room_001' as never,
  new Date('2026-07-26T00:00:00Z'),
)

describe('requiresTalkRoomMembershipCheck', () => {
  it('未参加なら在籍照会が要る', () => {
    expect(requiresTalkRoomMembershipCheck(NOT_JOINED_SHARED_TALK_ROOM)).toBe(true)
  })

  // 参加済みなら結果に関わらず記録は変わらない。Webhook の応答パスに無駄な外部呼び出しを乗せない
  it('参加済みなら在籍照会は要らない', () => {
    expect(requiresTalkRoomMembershipCheck(joined)).toBe(false)
  })
})

describe('decideSharedTalkRoomJoin', () => {
  it('未参加 かつ 在籍あり のときだけ記録する', () => {
    expect(decideSharedTalkRoomJoin(NOT_JOINED_SHARED_TALK_ROOM, { kind: 'member' })).toEqual({
      kind: 'record',
    })
  })

  it('世帯のユーザーが在籍していなければ記録しない', () => {
    expect(decideSharedTalkRoomJoin(NOT_JOINED_SHARED_TALK_ROOM, { kind: 'not_member' })).toEqual({
      kind: 'skip',
      reason: 'not_member',
    })
  })

  // 照会不能を「在籍あり」に倒すと API 障害を突いて取り違えを通せる。
  // 「在籍なし」に倒すと通信断のたびに正規の招待を捨てることになる。
  // やり直しても直らない失敗（設定不備など）は見送って終端する
  it('やり直しても直らない照会失敗は記録せず終端する', () => {
    expect(
      decideSharedTalkRoomJoin(NOT_JOINED_SHARED_TALK_ROOM, {
        kind: 'unknown',
        retryable: false,
        detail: 'LINE member API 403',
      }),
    ).toEqual({ kind: 'skip', reason: 'membership_unverified' })
  })

  // join は招待の瞬間にしか発生しない。一時障害をここで終端すると、正しいトークルームへ
  // 招待した夫婦が招待し直すまで配信先が登録されないまま止まる
  it('やり直しで直りうる照会失敗は Webhook の再送へ回す', () => {
    expect(
      decideSharedTalkRoomJoin(NOT_JOINED_SHARED_TALK_ROOM, {
        kind: 'unknown',
        retryable: true,
        detail: 'LINE member API 500',
      }),
    ).toEqual({ kind: 'retry_later' })
  })

  it('照会自体を行っていないときは記録しない', () => {
    expect(decideSharedTalkRoomJoin(NOT_JOINED_SHARED_TALK_ROOM, 'not_checked')).toEqual({
      kind: 'skip',
      reason: 'membership_unverified',
    })
  })

  // 上書き禁止（防御 1 段目）は在籍照会より強い。在籍が確認できても既存の配信先は変えない
  it('参加済みなら在籍ありでも記録しない', () => {
    expect(decideSharedTalkRoomJoin(joined, { kind: 'member' })).toEqual({
      kind: 'skip',
      reason: 'already_joined',
    })
  })

  it('参加済みのときは照会結果に関わらず記録しない', () => {
    for (const membership of [
      { kind: 'not_member' } as const,
      { kind: 'unknown', retryable: true, detail: 'x' } as const,
      'not_checked' as const,
    ]) {
      expect(decideSharedTalkRoomJoin(joined, membership)).toEqual({
        kind: 'skip',
        reason: 'already_joined',
      })
    }
  })
})
