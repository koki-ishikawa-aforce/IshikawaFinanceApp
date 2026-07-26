/**
 * LINE Webhook 受信ルート（#296 / #73 B 段）のエンドポイントテスト
 * @see docs/domain/03-open-questions.md OQ-55 ③ ④
 */
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { UserIdSchema, joinedTalkRoomIdOf, lineOperationSettingsOf } from '@warimaru/domain'
import type {
  LineFriendAdded,
  LineFriendshipStatus,
  LineTalkRoomJoined,
  LineTalkRoomMembershipGateway,
  LineTalkRoomMembershipQuery,
  LineTalkRoomMembershipStatus,
  UserId,
} from '@warimaru/domain'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp as baseCreateTestApp, request, VIEWER_ID } from '../helpers/test-app.js'
import type { AppDeps } from '../../src/composition-root.js'

const CHANNEL_SECRET = 'channel-secret-for-route-test'

/** 署名検証鍵はテストから注入する（本番コードに固定値を公開しない） */
function createTestApp(overrides: Partial<AppDeps> = {}): TestApp {
  return baseCreateTestApp({
    resolveLineChannelSecret: () => Promise.resolve(CHANNEL_SECRET),
    ...overrides,
  })
}

const TALK_ROOM_ID = 'Cgroup-warimaru-0001'
const OTHER_TALK_ROOM_ID = 'Cgroup-warimaru-0002'
const UNREGISTERED_USER_ID = 'Uunregistered-0001'

function sign(body: string, secret = CHANNEL_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

/** 署名付きの Webhook リクエスト。signature を渡すと署名を差し替える（不正署名の検証用） */
async function postWebhook(
  t: TestApp,
  payload: unknown,
  options: { signature?: string | null } = {},
): Promise<Response> {
  const body = JSON.stringify(payload)
  const signature = options.signature === undefined ? sign(body) : options.signature
  return t.app.request('/webhook/line', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signature !== null ? { 'x-line-signature': signature } : {}),
    },
    body,
  })
}

function followPayload(userId: string): unknown {
  return {
    destination: 'U0123456789abcdef',
    events: [
      {
        type: 'follow',
        replyToken: 'reply-token-0001',
        timestamp: 1_760_000_000_000,
        source: { type: 'user', userId },
      },
    ],
  }
}

function joinPayload(groupId: string): unknown {
  return {
    destination: 'U0123456789abcdef',
    events: [
      {
        type: 'join',
        replyToken: 'reply-token-0002',
        timestamp: 1_760_000_000_000,
        source: { type: 'group', groupId },
      },
    ],
  }
}

/**
 * 在籍照会（#371）を固定の結果に差し替える。開発モードの既定モックは常に `member` を返し
 * 在籍確認を素通しするため、記録しない側の経路はここで明示的に作る。
 */
function membershipGateway(status: LineTalkRoomMembershipStatus): LineTalkRoomMembershipGateway {
  return { checkMembership: () => Promise.resolve(status) }
}

/** 許可リスト上の viewer を AppUser として登録する */
async function register(t: TestApp): Promise<void> {
  const res = await request(t.app, 'POST', '/api/onboarding/register', { body: {} })
  expect([200, 201]).toContain(res.status)
}

function subscribeFriendAdded(t: TestApp): LineFriendAdded[] {
  const log: LineFriendAdded[] = []
  t.deps.eventBus.subscribe<LineFriendAdded>('LineFriendAdded', e => {
    log.push(e)
    return Promise.resolve()
  })
  return log
}

function subscribeTalkRoomJoined(t: TestApp): LineTalkRoomJoined[] {
  const log: LineTalkRoomJoined[] = []
  t.deps.eventBus.subscribe<LineTalkRoomJoined>('LineTalkRoomJoined', e => {
    log.push(e)
    return Promise.resolve()
  })
  return log
}

async function friendAddKindOf(t: TestApp, userId: UserId = VIEWER_ID): Promise<string> {
  const user = await t.deps.appUserRepository.findById(userId)
  expect(user).not.toBeNull()
  return lineOperationSettingsOf(user!).friendAdd.kind
}

/** 記録された友だち追加日時（未記録なら null）。上書きが起きていないことの確認に使う */
async function friendAddedAtOf(t: TestApp, userId: UserId = VIEWER_ID): Promise<Date | null> {
  const user = await t.deps.appUserRepository.findById(userId)
  expect(user).not.toBeNull()
  const friendAdd = lineOperationSettingsOf(user!).friendAdd
  return friendAdd.kind === 'added' ? friendAdd.followWebhookReceivedAt : null
}

describe('POST /webhook/line — 署名検証', () => {
  it('正しい署名のリクエストを受理する', async () => {
    const t = createTestApp()
    await register(t)
    const res = await postWebhook(t, followPayload(VIEWER_ID))
    expect(res.status).toBe(200)
  })

  it('署名ヘッダーが無いリクエストを 401 で拒否し、記録もしない', async () => {
    const t = createTestApp()
    await register(t)
    const log = subscribeFriendAdded(t)

    const res = await postWebhook(t, followPayload(VIEWER_ID), { signature: null })

    expect(res.status).toBe(401)
    expect(await friendAddKindOf(t)).toBe('not_added')
    expect(log).toHaveLength(0)
  })

  it('別の Channel Secret で署名されたリクエストを 401 で拒否し、記録もしない', async () => {
    const t = createTestApp()
    await register(t)
    const log = subscribeFriendAdded(t)

    const body = JSON.stringify(followPayload(VIEWER_ID))
    const res = await postWebhook(t, followPayload(VIEWER_ID), {
      signature: sign(body, 'attacker-secret'),
    })

    expect(res.status).toBe(401)
    expect(await friendAddKindOf(t)).toBe('not_added')
    expect(log).toHaveLength(0)
  })

  it('本文だけ差し替えられたリクエスト（正規の署名の使い回し）を 401 で拒否する', async () => {
    const t = createTestApp()
    await register(t)
    const log = subscribeTalkRoomJoined(t)

    // 正規に署名された別ペイロードの署名を、改ざんした本文に付け替える
    const signatureOfOtherBody = sign(JSON.stringify(joinPayload(OTHER_TALK_ROOM_ID)))
    const res = await postWebhook(t, joinPayload(TALK_ROOM_ID), {
      signature: signatureOfOtherBody,
    })

    expect(res.status).toBe(401)
    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBeUndefined()
    expect(log).toHaveLength(0)
  })

  it('Channel Secret を解決できない場合は 500 を返し、署名を検証しないまま受理しない', async () => {
    const t = createTestApp({
      resolveLineChannelSecret: () => Promise.reject(new Error('Parameter Store が未構成')),
    })
    await register(t)
    const log = subscribeFriendAdded(t)

    const res = await postWebhook(t, followPayload(VIEWER_ID))

    expect(res.status).toBe(500)
    expect(await friendAddKindOf(t)).toBe('not_added')
    expect(log).toHaveLength(0)
  })
})

describe('POST /webhook/line — follow（友だち追加）', () => {
  it('登録済みユーザーの follow で友達追加を記録し LineFriendAdded を発行する', async () => {
    const t = createTestApp()
    await register(t)
    const log = subscribeFriendAdded(t)

    const res = await postWebhook(t, followPayload(VIEWER_ID))

    expect(res.status).toBe(200)
    expect(await friendAddKindOf(t)).toBe('added')
    expect(log).toHaveLength(1)
    expect(log[0]?.userId).toBe(VIEWER_ID)
  })

  it('未登録ユーザーの follow はエラーにせずログのみで完了する（OQ-55 ③）', async () => {
    const t = createTestApp()
    const log = subscribeFriendAdded(t)

    const res = await postWebhook(t, followPayload(UNREGISTERED_USER_ID))

    expect(res.status).toBe(200)
    expect(await t.deps.appUserRepository.findById(UserIdSchema.parse(UNREGISTERED_USER_ID))).toBe(
      null,
    )
    expect(log).toHaveLength(0)
  })

  it('同一 follow の再送で二重記録・二重発行が起きない（冪等）', async () => {
    const t = createTestApp()
    await register(t)
    const log = subscribeFriendAdded(t)

    expect((await postWebhook(t, followPayload(VIEWER_ID))).status).toBe(200)
    expect((await postWebhook(t, followPayload(VIEWER_ID))).status).toBe(200)

    expect(await friendAddKindOf(t)).toBe('added')
    expect(log).toHaveLength(1)
  })

  it('登録前の follow は破棄され、登録完了時の友だち状態照会が1回だけ拾い直す（#297 / OQ-55 ③）', async () => {
    const t = createTestApp({
      lineFriendshipGateway: {
        checkFriendship: (): Promise<LineFriendshipStatus> => Promise.resolve({ kind: 'friend' }),
      },
    })
    const log = subscribeFriendAdded(t)

    // 登録前に届いた follow は宛先ユーザーが居らず破棄される
    expect((await postWebhook(t, followPayload(VIEWER_ID))).status).toBe(200)
    expect(await t.deps.appUserRepository.findById(VIEWER_ID)).toBeNull()
    expect(log).toHaveLength(0)

    // 登録完了時の照会で拾い直す
    await register(t)
    expect(await friendAddKindOf(t)).toBe('added')
    expect(log).toHaveLength(1)
    const recordedAt = await friendAddedAtOf(t)

    // 拾い直した後に follow が再送されても二重記録・二重発行にならない（記録日時も動かない）
    expect((await postWebhook(t, followPayload(VIEWER_ID))).status).toBe(200)
    expect(log).toHaveLength(1)
    expect(await friendAddKindOf(t)).toBe('added')
    expect(await friendAddedAtOf(t)).toEqual(recordedAt)
  })

  it('照会の待ち時間中に follow が届いても二重記録・二重発行にならない（#297）', async () => {
    // 二重記録が実際に起こりうるのはこの順序。照会前に読んだスナップショットへ適用すると
    // recordLineFriendAdded の冪等判定が効かず、再保存と LineFriendAdded の二重発行になる。
    // 登録の保存は照会より前に済んでいるため、照会中の follow は宛先を見つけて記録できる
    const ref: { app?: TestApp } = {}
    const t = createTestApp({
      lineFriendshipGateway: {
        checkFriendship: async (): Promise<LineFriendshipStatus> => {
          const running = ref.app
          if (running !== undefined) {
            expect((await postWebhook(running, followPayload(VIEWER_ID))).status).toBe(200)
          }
          return { kind: 'friend' }
        },
      },
    })
    ref.app = t
    const log = subscribeFriendAdded(t)

    const res = await request(t.app, 'POST', '/api/onboarding/register', { body: {} })

    expect(res.status).toBe(201)
    expect(await friendAddKindOf(t)).toBe('added')
    // Webhook 側が記録した 1 件だけが残り、登録時刻での上書きも起きない
    expect(log).toHaveLength(1)
    expect(await friendAddedAtOf(t)).toEqual(log[0]?.receivedAt)
  })
})

describe('POST /webhook/line — join（共通トークルーム参加）', () => {
  it('join で世帯レベルの共通トークルームIDを記録し LineTalkRoomJoined を発行する', async () => {
    const t = createTestApp()
    const log = subscribeTalkRoomJoined(t)

    const res = await postWebhook(t, joinPayload(TALK_ROOM_ID))

    expect(res.status).toBe(200)
    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBe(TALK_ROOM_ID)
    expect(log).toHaveLength(1)
    expect(log[0]?.talkRoomId).toBe(TALK_ROOM_ID)
  })

  // #371 で在籍確認を入れる前は、AppUser が 1 人も登録されていなくても記録していた。
  // その状態は「夫婦より先に第三者が招待する」取り合いがちょうど成立する場面であり、
  // 照会する相手がいない以上、記録せず見送る側へ倒す
  it('アプリユーザーが 1 人も登録されていないときは在籍を確認できないため記録しない', async () => {
    const t = createTestApp({
      lineTalkRoomMembershipGateway: membershipGateway({
        kind: 'unknown',
        detail: '照会対象のアプリユーザーが登録されていない',
      }),
    })
    const log = subscribeTalkRoomJoined(t)

    expect((await postWebhook(t, joinPayload(TALK_ROOM_ID))).status).toBe(200)

    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBeUndefined()
    expect(log).toHaveLength(0)
  })

  // 第三者が公式アカウントを自分のグループへ招待しても正規の join が発生する。
  // 記録してしまうと以後は上書きできず、家計サマリの配信先が第三者のグループに固定される
  it('世帯のユーザーが在籍していないトークルームの join は記録しない', async () => {
    const t = createTestApp({
      lineTalkRoomMembershipGateway: membershipGateway({ kind: 'not_member' }),
    })
    await register(t)
    const log = subscribeTalkRoomJoined(t)

    const res = await postWebhook(t, joinPayload(TALK_ROOM_ID))

    expect(res.status).toBe(200)
    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBeUndefined()
    expect(log).toHaveLength(0)
  })

  // 照会に失敗した回を「在籍あり」に倒すと、API 障害を突く形で取り違えを通せてしまう
  it('在籍を照会できなかったときも記録しない（照会失敗を在籍ありに倒さない）', async () => {
    const t = createTestApp({
      lineTalkRoomMembershipGateway: membershipGateway({
        kind: 'unknown',
        detail: 'LINE member API 500',
      }),
    })
    await register(t)
    const log = subscribeTalkRoomJoined(t)

    expect((await postWebhook(t, joinPayload(TALK_ROOM_ID))).status).toBe(200)

    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBeUndefined()
    expect(log).toHaveLength(0)
  })

  it('在籍照会には登録済みユーザーの LINE_userID と、届いたトークルームの種別・IDを渡す', async () => {
    const queries: LineTalkRoomMembershipQuery[] = []
    const t = createTestApp({
      lineTalkRoomMembershipGateway: {
        checkMembership: query => {
          queries.push(query)
          return Promise.resolve({ kind: 'member' } as const)
        },
      },
    })
    await register(t)

    await postWebhook(t, joinPayload(TALK_ROOM_ID))

    expect(queries).toHaveLength(1)
    expect(queries[0]?.talkRoomKind).toBe('group')
    expect(queries[0]?.talkRoomId).toBe(TALK_ROOM_ID)
    expect(queries[0]?.userIds).toContain(VIEWER_ID)
  })

  // 種別を取り違えると LINE 側は常に 404 を返し、正規の招待が「在籍なし」として捨てられる
  it('複数人トークの join では room 種別で在籍を照会する', async () => {
    const queries: LineTalkRoomMembershipQuery[] = []
    const t = createTestApp({
      lineTalkRoomMembershipGateway: {
        checkMembership: query => {
          queries.push(query)
          return Promise.resolve({ kind: 'member' } as const)
        },
      },
    })
    await register(t)

    await postWebhook(t, {
      events: [{ type: 'join', source: { type: 'room', roomId: TALK_ROOM_ID } }],
    })

    expect(queries[0]?.talkRoomKind).toBe('room')
  })

  // 既存の記録がある場合の上書き禁止（防御 1 段目）は在籍照会より前に効くべきで、
  // 照会の成否に関わらず配信先は変わらない
  it('既に参加記録があるときは在籍照会を行わない', async () => {
    let called = 0
    const t = createTestApp({
      lineTalkRoomMembershipGateway: {
        checkMembership: () => {
          called += 1
          return Promise.resolve({ kind: 'member' } as const)
        },
      },
    })
    await register(t)
    await postWebhook(t, joinPayload(TALK_ROOM_ID))
    expect(called).toBe(1)

    await postWebhook(t, joinPayload(OTHER_TALK_ROOM_ID))

    expect(called).toBe(1)
    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBe(TALK_ROOM_ID)
  })

  it('同一 join の再送で二重記録・二重発行が起きない（冪等）', async () => {
    const t = createTestApp()
    const log = subscribeTalkRoomJoined(t)

    expect((await postWebhook(t, joinPayload(TALK_ROOM_ID))).status).toBe(200)
    expect((await postWebhook(t, joinPayload(TALK_ROOM_ID))).status).toBe(200)

    expect(log).toHaveLength(1)
  })

  // join の source は userId を含まず、届いたトークルームが自世帯のものかは判定できない。
  // 共通トークルームは家計サマリの配信先そのものなので、Webhook からの上書きは許さない
  it('既に参加記録があるとき、別トークルームの join では配信先を差し替えない', async () => {
    const t = createTestApp()
    const log = subscribeTalkRoomJoined(t)

    await postWebhook(t, joinPayload(TALK_ROOM_ID))
    const res = await postWebhook(t, joinPayload(OTHER_TALK_ROOM_ID))

    expect(res.status).toBe(200)
    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBe(TALK_ROOM_ID)
    expect(log).toHaveLength(1)
  })

  it('参加先の変更は LIFF 認証つきの自己申告 API では引き続き行える', async () => {
    const t = createTestApp()
    await register(t)
    await postWebhook(t, joinPayload(TALK_ROOM_ID))

    const res = await request(t.app, 'POST', '/api/onboarding/phase1/talk-room', {
      body: { talkRoomId: OTHER_TALK_ROOM_ID },
    })

    expect(res.status).toBe(200)
    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBe(
      OTHER_TALK_ROOM_ID,
    )
  })

  it('複数人トーク（source.type = room）の join も参加として記録する', async () => {
    const t = createTestApp()

    const res = await postWebhook(t, {
      events: [{ type: 'join', source: { type: 'room', roomId: TALK_ROOM_ID } }],
    })

    expect(res.status).toBe(200)
    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBe(TALK_ROOM_ID)
  })
})

describe('POST /webhook/line — 対象外イベント', () => {
  it('follow / join 以外のイベントは受理して何も記録しない', async () => {
    const t = createTestApp()
    await register(t)
    const friendLog = subscribeFriendAdded(t)
    const joinLog = subscribeTalkRoomJoined(t)

    const res = await postWebhook(t, {
      events: [
        { type: 'message', source: { type: 'user', userId: VIEWER_ID } },
        { type: 'unfollow', source: { type: 'user', userId: VIEWER_ID } },
        { type: 'leave', source: { type: 'group', groupId: TALK_ROOM_ID } },
      ],
    })

    expect(res.status).toBe(200)
    expect(await friendAddKindOf(t)).toBe('not_added')
    expect(joinedTalkRoomIdOf(await t.deps.sharedTalkRoomRepository.find())).toBeUndefined()
    expect(friendLog).toHaveLength(0)
    expect(joinLog).toHaveLength(0)
  })

  it('events が空のリクエスト（LINE Developers の検証ボタン）を受理する', async () => {
    const t = createTestApp()
    const res = await postWebhook(t, { destination: 'U0123456789abcdef', events: [] })
    expect(res.status).toBe(200)
  })

  it('必要な ID を欠く follow / join は例外にせず読み飛ばし、同バッチの正常なイベントは処理する', async () => {
    const t = createTestApp()
    await register(t)
    const friendLog = subscribeFriendAdded(t)
    const joinLog = subscribeTalkRoomJoined(t)

    const res = await postWebhook(t, {
      events: [
        { type: 'follow', source: { type: 'user' } },
        { type: 'join', source: { type: 'group' } },
        { type: 'follow', source: { type: 'user', userId: VIEWER_ID } },
      ],
    })

    expect(res.status).toBe(200)
    expect(friendLog).toHaveLength(1)
    expect(joinLog).toHaveLength(0)
  })

  it('上限を超える本文は署名検証より前に 413 で拒否する（未認証の DoS 対策）', async () => {
    const t = createTestApp()
    // 1 MiB 超のイベントを 1 件だけ含む、形としては正しい JSON
    const body = JSON.stringify({ events: [{ type: 'message', padding: 'x'.repeat(1024 * 1024) }] })
    const res = await t.app.request('/webhook/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(body) },
      body,
    })
    expect(res.status).toBe(413)
  })

  it('署名は正しいが JSON として壊れている本文は 400 で拒否する', async () => {
    const t = createTestApp()
    const body = '{"events":'
    const res = await t.app.request('/webhook/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(body) },
      body,
    })
    expect(res.status).toBe(400)
  })
})

describe('/webhook/line のマウント位置', () => {
  it('LIFF 認証（/api/*）の外にあり、X-User-Id なしでも到達できる（OQ-55 ④）', async () => {
    const t = createTestApp()
    // X-User-Id を付けずに署名だけで受理される = 認証ミドルウェアを通っていない
    const res = await postWebhook(t, joinPayload(TALK_ROOM_ID))
    expect(res.status).toBe(200)
  })
})
