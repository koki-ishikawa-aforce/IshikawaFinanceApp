/**
 * LINE 友だち状態照会ゲートウェイ（#297 / #73 C 段）の単体テスト
 * @see docs/domain/03-open-questions.md OQ-55 ③
 */
import { describe, it, expect } from 'vitest'
import { UserIdSchema } from '@warimaru/domain'
import { createLineFriendshipGateway } from '../../src/line-friendship/line-friendship-gateway.js'

const USER_ID = UserIdSchema.parse('Uhoney-0001')

function stubFetch(response: { status: number; body?: unknown }): {
  fetchImpl: typeof fetch
  requests: { url: string; init: RequestInit }[]
} {
  const requests: { url: string; init: RequestInit }[] = []
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} })
    return Promise.resolve(
      new Response(JSON.stringify(response.body ?? {}), { status: response.status }),
    )
  }) as typeof fetch
  return { fetchImpl, requests }
}

/** fetch が例外で失敗する状況（通信断・タイムアウト）を再現する */
function throwingFetch(error: Error): typeof fetch {
  return (() => Promise.reject(error)) as typeof fetch
}

describe('createLineFriendshipGateway', () => {
  it('プロフィール照会が 200 なら friend を返し、Bearer トークンで照会する', async () => {
    const { fetchImpl, requests } = stubFetch({
      status: 200,
      body: { userId: USER_ID, displayName: 'はにー', pictureUrl: 'https://example.com/p.png' },
    })
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl,
    })

    // 応答ボディの displayName / pictureUrl（PII）は結果に持ち込まない
    expect(await gateway.checkFriendship(USER_ID)).toEqual({ kind: 'friend' })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(`https://api.line.me/v2/bot/profile/${USER_ID}`)
    expect(requests[0]?.init.method).toBe('GET')
    expect((requests[0]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-123',
    )
    // 応答が返らないまま登録リクエストがぶら下がらないよう、必ず打ち切り signal を渡す
    expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('userId をパスへ埋め込む際にエスケープする', async () => {
    const { fetchImpl, requests } = stubFetch({ status: 404 })
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl,
    })

    await gateway.checkFriendship(UserIdSchema.parse('../../v2/bot/message/push?x=1'))

    expect(requests[0]?.url).toBe(
      'https://api.line.me/v2/bot/profile/..%2F..%2Fv2%2Fbot%2Fmessage%2Fpush%3Fx%3D1',
    )
  })

  it('応答が返らない場合は打ち切って unknown にする', async () => {
    // signal の abort を待つ fetch。timeoutMs を過ぎたら AbortError で reject される
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })) as typeof fetch
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl,
      timeoutMs: 20,
    })

    const status = await gateway.checkFriendship(USER_ID)
    expect(status).toEqual({ kind: 'unknown', detail: 'LINE profile API がタイムアウトした' })
  })

  it('404 は not_friend（友だち未追加 / ブロック済み）へ翻訳する', async () => {
    const { fetchImpl } = stubFetch({ status: 404, body: { message: 'Not found' } })
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl,
    })

    expect(await gateway.checkFriendship(USER_ID)).toEqual({ kind: 'not_friend' })
  })

  it('404 以外の HTTP エラーは unknown（not_friend に倒さない）', async () => {
    // 応答ボディにエラー詳細が入っていても detail はステータスのみに絞る（呼出し側がログに出すため）
    const { fetchImpl } = stubFetch({ status: 500, body: { message: 'internal', request: {} } })
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl,
    })

    const status = await gateway.checkFriendship(USER_ID)
    expect(status).toEqual({ kind: 'unknown', detail: 'LINE profile API 500' })
  })

  it('認証エラー（401）も unknown にする — 設定不備を「友だちでない」と誤って確定させない', async () => {
    const { fetchImpl } = stubFetch({ status: 401, body: { message: 'Invalid access token' } })
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => Promise.resolve('expired-token'),
      fetchImpl,
    })

    const status = await gateway.checkFriendship(USER_ID)
    expect(status).toEqual({ kind: 'unknown', detail: 'LINE profile API 401' })
  })

  it('通信断は unknown', async () => {
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl: throwingFetch(new TypeError('fetch failed')),
    })

    const status = await gateway.checkFriendship(USER_ID)
    expect(status.kind).toBe('unknown')
  })

  it('タイムアウトは unknown', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl: throwingFetch(timeout),
    })

    const status = await gateway.checkFriendship(USER_ID)
    expect(status.kind).toBe('unknown')
    expect(status.kind === 'unknown' && status.detail).toContain('タイムアウト')
  })

  it('Channel Access Token の解決に失敗したら照会せず unknown を返す', async () => {
    const { fetchImpl, requests } = stubFetch({ status: 200 })
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () =>
        Promise.reject(new Error('/warimaru/line/channel-access-token が見つからない')),
      fetchImpl,
    })

    const status = await gateway.checkFriendship(USER_ID)
    expect(status.kind).toBe('unknown')
    expect(requests).toHaveLength(0)
  })

  it('Channel Access Token の解決が返ってこない場合も打ち切って unknown にする', async () => {
    // Parameter Store / DB クライアントは自前のタイムアウトを持たないため、ここで上限を掛ける
    const { fetchImpl, requests } = stubFetch({ status: 200 })
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => new Promise<string>(() => undefined),
      fetchImpl,
      timeoutMs: 20,
    })

    const status = await gateway.checkFriendship(USER_ID)
    expect(status).toEqual({
      kind: 'unknown',
      detail: 'Channel Access Token の解決がタイムアウトした',
    })
    expect(requests).toHaveLength(0)
  })

  it('照会失敗の detail に例外の中身を含めない（Parameter Store のパス等の流出防止）', async () => {
    const secretPath = '/warimaru/line/channel-access-token'
    const { fetchImpl, requests } = stubFetch({ status: 200 })
    const gateway = createLineFriendshipGateway({
      resolveChannelAccessToken: () => Promise.reject(new Error(`${secretPath} が見つからない`)),
      fetchImpl,
    })

    const status = await gateway.checkFriendship(USER_ID)
    expect(status.kind).toBe('unknown')
    expect(status.kind === 'unknown' && status.detail).not.toContain(secretPath)
    expect(requests).toHaveLength(0)
  })
})
