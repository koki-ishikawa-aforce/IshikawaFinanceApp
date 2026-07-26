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

  // Test M2: HTTP 呼び出し側の打ち切り。ここが効かないと Webhook の応答が LINE の
  // タイムアウトまでぶら下がり、しかも userIds の件数だけ待ち時間が積み上がる
  it('LINE の応答が返らない場合は打ち切って unknown を返す', async () => {
    // signal の abort を待つ fetch。timeoutMs を過ぎたら AbortError で reject される
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })) as typeof fetch

    const result = await gatewayWith(fetchImpl, 20).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID],
    })

    // タイムアウトはやり直しで直りうる。route はこれを Webhook の再送に回す
    expect(result).toEqual({
      kind: 'unknown',
      retryable: true,
      detail: 'LINE member API がタイムアウトした',
    })
  })

  // 権限・設定不備はやり直しても直らない。retryable にすると LINE の再送が空振りし続ける
  it('401 / 403 は設定不備として retryable=false を返す', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => response(status)) as unknown as typeof fetch

      const result = await gatewayWith(fetchImpl).checkMembership({
        talkRoomKind: 'group',
        talkRoomId: TALK_ROOM_ID,
        userIds: [HONEY_ID],
      })

      expect(result.kind).toBe('unknown')
      expect(result.kind === 'unknown' && result.retryable).toBe(false)
    }
  })

  it('5xx はやり直しで直りうる失敗として retryable=true を返す', async () => {
    const fetchImpl = vi.fn(async () => response(503)) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID],
    })

    expect(result.kind === 'unknown' && result.retryable).toBe(true)
  })

  it('照会対象が居ない・識別子が異常な場合はやり直しても直らない（retryable=false）', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as typeof fetch
    const gateway = gatewayWith(fetchImpl)

    const noUsers = await gateway.checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [],
    })
    const tooLong = await gateway.checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TalkRoomIdSchema.parse('C'.repeat(201)),
      userIds: [HONEY_ID],
    })

    expect(noUsers.kind === 'unknown' && noUsers.retryable).toBe(false)
    expect(tooLong.kind === 'unknown' && tooLong.retryable).toBe(false)
  })

  // 1 回ごとの上限だけでは、人数分の逐次呼び出しで合計時間が伸びる
  it('照会全体の締め切りを超えたら残りのユーザーを照会せず打ち切る', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      await new Promise(resolve => setTimeout(resolve, 30))
      return response(404)
    }) as unknown as typeof fetch
    const gateway = createLineTalkRoomMembershipGateway({
      resolveChannelAccessToken: () => Promise.resolve('channel-access-token'),
      fetchImpl,
      timeoutMs: 100,
      totalTimeoutMs: 20,
    })

    const result = await gateway.checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID, DARLING_ID],
    })

    expect(calls).toHaveLength(1)
    expect(result.kind).toBe('unknown')
    expect(result.kind === 'unknown' && result.retryable).toBe(true)
  })

  // Test S3: 早期 return を「全件集めてから失敗を優先する」形に変えると、正規の招待が
  // unknown として捨てられる（join は再送されないため回復は招待やり直しのみ）
  it('先に失敗した相手がいても、後の相手が在籍していれば member を返す', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes(HONEY_ID) ? response(500) : response(200),
    ) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TALK_ROOM_ID,
      userIds: [HONEY_ID, DARLING_ID],
    })

    expect(result).toEqual({ kind: 'member' })
  })

  // Test S4: ID は Webhook 由来の外部入力。エスケープを外すとパスを組み替えられる
  it('トークルームID・LINE_userID を URL パスへエスケープして埋め込む', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return response(404)
    }) as unknown as typeof fetch

    await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TalkRoomIdSchema.parse('../../v2/bot/message/push?x=1'),
      userIds: [UserIdSchema.parse('../u')],
    })

    expect(calls[0]).toBe(
      'https://api.line.me/v2/bot/group/..%2F..%2Fv2%2Fbot%2Fmessage%2Fpush%3Fx%3D1/member/..%2Fu',
    )
  })

  // Webhook 本文由来の文字列を長さ無制限のまま外部 API の URL へ載せない
  it('識別子の長さが想定を超えるときは LINE を呼ばず unknown を返す', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TalkRoomIdSchema.parse('C'.repeat(201)),
      userIds: [HONEY_ID],
    })

    expect(result.kind).toBe('unknown')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // 上限は実在の ID（33 文字程度）から十分に離してあり、正規の招待を弾かない
  it('通常の長さの識別子は上限に掛からない', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).checkMembership({
      talkRoomKind: 'group',
      talkRoomId: TalkRoomIdSchema.parse(`C${'0'.repeat(32)}`),
      userIds: [UserIdSchema.parse(`U${'0'.repeat(32)}`)],
    })

    expect(result).toEqual({ kind: 'member' })
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
