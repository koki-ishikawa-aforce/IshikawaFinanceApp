/**
 * LineTalkRoomMembershipGateway（LINE Messaging API 実装、#371 / OQ-55 ①）の単体テスト
 *
 * HTTP はモックする。確かめたいのは「LINE の応答をどう在籍状態へ翻訳するか」であり、
 * 誤って `not_member` / `member` に倒すと、招待の取り違え（第三者のトークルームが配信先に
 * なる）か、逆に正規の招待を取りこぼす。
 */
import { describe, it, expect, vi } from 'vitest'
import { TalkRoomIdSchema, UserIdSchema } from '@warimaru/domain'
import { createLineTalkRoomMembershipGateway } from '../../src/line-talk-room-membership/line-talk-room-membership-gateway.js'

const TALK_ROOM_ID = TalkRoomIdSchema.parse('Cgroup-warimaru-0001')
const HONEY_ID = UserIdSchema.parse('Uhoney-0001')
const DARLING_ID = UserIdSchema.parse('Udarling-0001')

function gatewayWith(
  fetchImpl: typeof fetch,
  timeoutMs = 50,
): ReturnType<typeof createLineTalkRoomMembershipGateway> {
  return createLineTalkRoomMembershipGateway({
    resolveChannelAccessToken: () => Promise.resolve('channel-access-token'),
    fetchImpl,
    timeoutMs,
  })
}

function response(status: number): Response {
  return new Response(status === 200 ? '{}' : '', { status })
}

describe('LineTalkRoomMembershipGateway', () => {
  it('世帯のいずれかが在籍していれば member を返す', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes(DARLING_ID) ? response(200) : response(404),
    ) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID, DARLING_ID],
    })

    expect(result).toEqual({ kind: 'member' })
  })

  it('在籍が分かった時点で残りのユーザーは照会しない（LINE への呼び出しを増やさない）', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as typeof fetch

    await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID, DARLING_ID],
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('全員が 404 なら not_member を返す', async () => {
    const fetchImpl = vi.fn(async () => response(404)) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID, DARLING_ID],
    })

    expect(result).toEqual({ kind: 'not_member' })
  })

  // 404 以外を not_member に倒すと、API 障害を根拠に「夫婦のトークルームではない」を確定させる
  it('404 以外の HTTP エラーが混ざり在籍が確認できないときは unknown を返す（not_member にしない）', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes(HONEY_ID) ? response(500) : response(404),
    ) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID, DARLING_ID],
    })

    expect(result.kind).toBe('unknown')
  })

  // 逆に unknown を member へ倒すと、照会を足した目的（取り違えの防止）が失われる
  it('通信に失敗したときも member にはせず unknown を返す', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID],
    })

    expect(result.kind).toBe('unknown')
  })

  it('Channel Access Token を解決できないときは LINE を呼ばず unknown を返す', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as typeof fetch
    const gateway = createLineTalkRoomMembershipGateway({
      resolveChannelAccessToken: () => Promise.reject(new Error('parameter store down')),
      fetchImpl,
      timeoutMs: 50,
    })

    const result = await gateway.checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID],
    })

    expect(result.kind).toBe('unknown')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('トークン解決が返らないときはタイムアウトして unknown を返す（Webhook の応答を待たせない）', async () => {
    const gateway = createLineTalkRoomMembershipGateway({
      resolveChannelAccessToken: () => new Promise<string>(() => {}),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      timeoutMs: 20,
    })

    const result = await gateway.checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID],
    })

    expect(result.kind).toBe('unknown')
  })

  it('照会対象のユーザーが 1 人もいないときは LINE を呼ばず unknown を返す', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [],
    })

    expect(result.kind).toBe('unknown')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // グループと複数人トークで LINE のエンドポイントが分かれる。取り違えると常に 404 になり、
  // 正規の招待が not_member として捨てられる
  it('グループと複数人トークで在籍照会のエンドポイントを使い分ける', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return response(404)
    }) as unknown as typeof fetch
    const gateway = gatewayWith(fetchImpl)

    await gateway.checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID],
    })
    await gateway.checkMembership({
      talkRoomKind: 'room',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID],
    })

    expect(calls[0]).toBe(`https://api.line.me/v2/bot/group/${TALK_ROOM_ID}/member/${HONEY_ID}`)
    expect(calls[1]).toBe(`https://api.line.me/v2/bot/room/${TALK_ROOM_ID}/member/${HONEY_ID}`)
  })

  // detail は呼出し側がそのままログへ出す。トークルームID・LINE_userID は個人を辿れる識別子
  it('unknown の detail に トークルームID・LINE_userID・トークンを含めない', async () => {
    const fetchImpl = vi.fn(async () => response(503)) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID],
    })

    expect(result.kind).toBe('unknown')
    const detail = result.kind === 'unknown' ? result.detail : ''
    expect(detail).not.toContain(TALK_ROOM_ID)
    expect(detail).not.toContain(HONEY_ID)
    expect(detail).not.toContain('channel-access-token')
  })

  it('Authorization ヘッダーに Channel Access Token を載せる', async () => {
    let authorization: string | undefined
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('Authorization') ?? undefined
      return response(200)
    }) as unknown as typeof fetch

    await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID],
    })

    expect(authorization).toBe('Bearer channel-access-token')
  })
})
