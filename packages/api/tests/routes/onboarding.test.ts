import { describe, it, expect, vi } from 'vitest'
import {
  AccountIdSchema,
  AccountSchema,
  BankNameSchema,
  BrokerageNameSchema,
  NOT_JOINED_SHARED_TALK_ROOM,
  TalkRoomIdSchema,
  UserIdSchema,
  recordSharedTalkRoomJoined,
  lineOperationSettingsOf,
  money,
  registerNisaAccount,
  registerOtherSavingsAccount,
} from '@warimaru/domain'
import type {
  AppUser,
  LineFriendAdded,
  LineFriendshipGateway,
  LineFriendshipStatus,
  NotificationActivated,
  OperationStarted,
  SharedTalkRoom,
  TestMessageSent,
  UserId,
} from '@warimaru/domain'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

interface UserResponse {
  user: {
    kind: string
    common: { userId: string; role: string; nickname?: string }
    progress?: {
      sectionA: { kind: string }
      sectionB: { kind: string }
      sectionF: { kind: string }
    }
  } | null
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

async function register(t: TestApp, viewerId = VIEWER_ID, nickname?: string): Promise<Response> {
  return request(t.app, 'POST', '/api/onboarding/register', {
    viewerId,
    body: nickname !== undefined ? { nickname } : {},
  })
}

/** 友だち状態照会のスタブ。呼び出された userId を記録し、照会しないことも検証できるようにする */
function stubFriendshipGateway(respond: () => Promise<LineFriendshipStatus>): {
  gateway: LineFriendshipGateway
  calls: UserId[]
} {
  const calls: UserId[] = []
  return {
    gateway: {
      checkFriendship(userId: UserId): Promise<LineFriendshipStatus> {
        calls.push(userId)
        return respond()
      },
    },
    calls,
  }
}

function subscribeFriendAdded(t: TestApp): LineFriendAdded[] {
  const log: LineFriendAdded[] = []
  t.deps.eventBus.subscribe<LineFriendAdded>('LineFriendAdded', e => {
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

/** Phase1 完了 → Phase2 進行中まで進める */
async function startPhase2(t: TestApp, viewerId = VIEWER_ID): Promise<void> {
  await register(t, viewerId)
  const res = await request(t.app, 'POST', '/api/onboarding/phase2/start', { viewerId })
  expect([200, 201]).toContain(res.status)
}

/** Gmail OAuth 認可 URL 発行 → コールバックで SectionA を完了させる */
async function completeSectionAViaOAuth(t: TestApp, viewerId = VIEWER_ID): Promise<Response> {
  const authorize = await request(t.app, 'POST', '/api/onboarding/gmail/authorize', { viewerId })
  expect(authorize.status).toBe(200)
  const { authorizationUrl } = await json<{ authorizationUrl: string }>(authorize)
  const state = new URL(authorizationUrl).searchParams.get('state')
  expect(state).not.toBeNull()
  return t.app.request(
    `/oauth/gmail/callback?code=dummy-code&state=${encodeURIComponent(state ?? '')}`,
  )
}

// 夫婦はそれぞれ自分名義の SMBC 銀行・別銀行貯蓄・NISA を持つ（01-overview.md §3、
// 05-scenario-b §Section B）。3 口座とも所有者照合の対象のため、所有者ごとに別 ID を割り当てる。
const VIEWER_SMBC_ID = '01HZZZZZZZZZZZZZZZZZZZZZ01'
const VIEWER_OTHER_SAVINGS_ID = '01HZZZZZZZZZZZZZZZZZZZZZ02'
const VIEWER_NISA_ID = '01HZZZZZZZZZZZZZZZZZZZZZ03'
const SPOUSE_SMBC_ID = '01HZZZZZZZZZZZZZZZZZZZZZ11'
const SPOUSE_OTHER_SAVINGS_ID = '01HZZZZZZZZZZZZZZZZZZZZZ12'
const SPOUSE_NISA_ID = '01HZZZZZZZZZZZZZZZZZZZZZ13'

/** viewer 本人名義の 3 口座（SMBC 銀行・別銀行貯蓄・NISA）を指す初期残高登録参照を組み立てる */
function initialBalanceRefFor(ownerId: UserId): {
  smbcAccountId: string
  otherSavingsAccountId: string
  nisaAccountId: string
} {
  const isSpouse = ownerId === SPOUSE_ID
  return {
    smbcAccountId: isSpouse ? SPOUSE_SMBC_ID : VIEWER_SMBC_ID,
    otherSavingsAccountId: isSpouse ? SPOUSE_OTHER_SAVINGS_ID : VIEWER_OTHER_SAVINGS_ID,
    nisaAccountId: isSpouse ? SPOUSE_NISA_ID : VIEWER_NISA_ID,
  }
}

const INITIAL_BALANCE_REF = initialBalanceRefFor(VIEWER_ID)

/** viewer 本人名義の SMBC 銀行口座を登録する（所有者照合の対象） */
async function seedSmbcAccount(t: TestApp, accountId: string, ownerId: UserId): Promise<void> {
  const at = new Date('2026-01-01T00:00:00Z')
  await t.deps.accountRepository.save(
    AccountSchema.parse({
      kind: 'smbc_bank',
      common: {
        accountId,
        ownerUserId: ownerId,
        registeredAt: at,
        activeness: { kind: 'active' },
      },
      balance: {
        currentBalance: 0,
        initialBalance: 0,
        initialBalanceBaselineAt: at,
        lastUpdatedAt: at,
      },
    }),
  )
}

/**
 * SectionB の事前条件「初期残高が登録された」を満たすため、initialBalanceRefFor(ownerId) が指す
 * 3 口座（ownerId 名義の SMBC 銀行・別銀行貯蓄・NISA）を残高・資産推移管理コンテキストに
 * 先に登録しておく。3 口座とも所有者照合の対象のため、参照する viewer 本人を ownerUserId として
 * 登録する。
 */
async function seedInitialBalanceAccounts(t: TestApp, ownerId: UserId = VIEWER_ID): Promise<void> {
  const at = new Date('2026-01-01T00:00:00Z')
  const ref = initialBalanceRefFor(ownerId)
  await seedSmbcAccount(t, ref.smbcAccountId, ownerId)
  await t.deps.accountRepository.save(
    registerOtherSavingsAccount({
      accountId: AccountIdSchema.parse(ref.otherSavingsAccountId),
      ownerUserId: ownerId,
      bankName: BankNameSchema.parse('楽天銀行'),
      initialBalance: money(500000),
      at,
    }),
  )
  await t.deps.accountRepository.save(
    registerNisaAccount({
      accountId: AccountIdSchema.parse(ref.nisaAccountId),
      ownerUserId: ownerId,
      brokerageName: BrokerageNameSchema.parse({ kind: 'sbi' }),
      initialAccumulated: money(200000),
      at,
    }),
  )
}

describe('POST /api/onboarding/register', () => {
  it('許可リスト一致で Phase1完了ユーザーとして登録される（201）', async () => {
    const t = createTestApp()
    const res = await register(t, VIEWER_ID, 'はにー')
    expect(res.status).toBe(201)
    const body = await json<UserResponse>(res)
    expect(body.user?.kind).toBe('phase1_completed')
    expect(body.user?.common.role).toBe('honey')
    expect(body.user?.common.nickname).toBe('はにー')
  })

  it('登録済みなら冪等に現状を返す（200）', async () => {
    const t = createTestApp()
    await register(t)
    const res = await register(t)
    expect(res.status).toBe(200)
  })

  it('許可リスト不一致は 403', async () => {
    const t = createTestApp()
    const res = await register(t, UserIdSchema.parse('user-stranger'))
    expect(res.status).toBe(403)
  })
})

/**
 * 登録前に友だち追加していた場合、その follow Webhook は宛先ユーザーが未登録のため破棄される
 * （OQ-55 ③）。自己申告 API も廃止されるため、登録時の照会が唯一の拾い直し経路になる。
 */
describe('POST /api/onboarding/register — 登録時の LINE 友だち状態照会（OQ-55 ③）', () => {
  it('登録前に友だち追加済みなら、登録完了時点で友だち追加として記録される', async () => {
    const stub = stubFriendshipGateway(() => Promise.resolve({ kind: 'friend' }))
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    const events = subscribeFriendAdded(t)

    const before = Date.now()
    const res = await register(t)
    const after = Date.now()

    expect(res.status).toBe(201)
    const friendAdd = (await json<{ user: AppUser }>(res)).user.common.lineOperationSettings
      ?.friendAdd
    expect(friendAdd?.kind).toBe('added')
    // Webhook 由来ではなく登録時刻が入る（follow を受信していないため）
    const recordedAt = new Date(
      friendAdd?.kind === 'added' ? (friendAdd.followWebhookReceivedAt as unknown as string) : 0,
    ).getTime()
    expect(recordedAt).toBeGreaterThanOrEqual(before)
    expect(recordedAt).toBeLessThanOrEqual(after)

    expect(stub.calls).toEqual([VIEWER_ID])
    expect(await friendAddKindOf(t)).toBe('added')
    expect(events).toHaveLength(1)
    expect(events[0]?.userId).toBe(VIEWER_ID)
  })

  it('友だちでない場合は記録されず、登録は正常に完了する', async () => {
    const stub = stubFriendshipGateway(() => Promise.resolve({ kind: 'not_friend' }))
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    const events = subscribeFriendAdded(t)

    const res = await register(t)
    expect(res.status).toBe(201)
    // 「照会して友だちでなかった」ことを固定する（照会自体をやめても通る形にしない）
    expect(stub.calls).toEqual([VIEWER_ID])
    expect(await friendAddKindOf(t)).toBe('not_added')
    expect(events).toHaveLength(0)
  })

  it('照会に失敗（unknown）しても登録は成功し、失敗はログに残る', async () => {
    const stub = stubFriendshipGateway(() =>
      Promise.resolve({ kind: 'unknown', detail: 'LINE profile API 500' }),
    )
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    const events = subscribeFriendAdded(t)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const res = await register(t)
      expect(res.status).toBe(201)
      expect(await friendAddKindOf(t)).toBe('not_added')
      expect(events).toHaveLength(0)
      // 無言の握りつぶしと区別する（失敗の理由がログに出ること）
      expect(logged).toHaveBeenCalledTimes(1)
      expect(String(logged.mock.calls[0]?.[0])).toContain('LINE profile API 500')
    } finally {
      logged.mockRestore()
    }
  })

  it('照会が例外を投げても登録は成功する', async () => {
    const stub = stubFriendshipGateway(() => Promise.reject(new Error('boom')))
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const res = await register(t)
      expect(res.status).toBe(201)
      expect((await json<{ user: AppUser }>(res)).user.kind).toBe('phase1_completed')
      expect(await friendAddKindOf(t)).toBe('not_added')
      expect(logged).toHaveBeenCalledTimes(1)
    } finally {
      logged.mockRestore()
    }
  })

  it('記録の保存に失敗しても登録は成功する（登録は既に永続化されているため巻き戻さない）', async () => {
    const stub = stubFriendshipGateway(() => Promise.resolve({ kind: 'friend' }))
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    const events = subscribeFriendAdded(t)
    const original = t.deps.appUserRepository.save.bind(t.deps.appUserRepository)
    let saves = 0
    t.deps.appUserRepository.save = (user: AppUser): Promise<void> => {
      saves += 1
      // 1 回目 = 登録そのもの、2 回目 = 友だち追加の記録
      return saves === 1 ? original(user) : Promise.reject(new Error('save failed'))
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const res = await register(t)
      expect(res.status).toBe(201)
      // 記録の保存が実際に試みられて失敗したことを固定する（未実行でも通る形にしない）
      expect(saves).toBe(2)
      expect(await friendAddKindOf(t)).toBe('not_added')
      expect(events).toHaveLength(0)
    } finally {
      logged.mockRestore()
    }
  })

  it('照会に失敗した回は、次の登録要求（冪等な 200）で再照会して回復する', async () => {
    // follow Webhook は友だち追加の瞬間にしか発生しないため、この再照会が唯一の回復経路になる
    const responses: LineFriendshipStatus[] = [
      { kind: 'unknown', detail: 'LINE profile API 500' },
      { kind: 'friend' },
    ]
    const stub = stubFriendshipGateway(() =>
      Promise.resolve(responses.shift() ?? { kind: 'not_friend' }),
    )
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    const events = subscribeFriendAdded(t)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      expect((await register(t)).status).toBe(201)
      expect(await friendAddKindOf(t)).toBe('not_added')

      const retry = await register(t)
      expect(retry.status).toBe(200)
      expect(
        (await json<{ user: AppUser }>(retry)).user.common.lineOperationSettings?.friendAdd.kind,
      ).toBe('added')
      expect(stub.calls).toEqual([VIEWER_ID, VIEWER_ID])
      expect(await friendAddKindOf(t)).toBe('added')
      expect(events).toHaveLength(1)
    } finally {
      logged.mockRestore()
    }
  })

  it('友だち追加が記録済みなら、以後の登録要求では照会しない', async () => {
    const stub = stubFriendshipGateway(() => Promise.resolve({ kind: 'friend' }))
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })

    expect((await register(t)).status).toBe(201)
    expect((await register(t)).status).toBe(200)
    expect(stub.calls).toEqual([VIEWER_ID])
  })
})

/**
 * 登録時の照会が失敗した回は、画面が登録要求を初回しか送らないため自力では回復できない
 * （自己申告ボタンは #298 で廃止される）。セットアップ画面からの明示的な確認が回復経路になる。
 */
describe('POST /api/onboarding/phase1/line-friend/check — 友だち追加の確認をやり直す（#417 A）', () => {
  interface CheckResponse {
    user: AppUser
    result: { kind: string }
  }

  async function check(t: TestApp, viewerId = VIEWER_ID): Promise<Response> {
    return request(t.app, 'POST', '/api/onboarding/phase1/line-friend/check', { viewerId })
  }

  /** 登録時の照会は空振りさせ、その後の応答だけを差し替える（回復の検証を登録と混ぜない） */
  function stubAfterRegistration(after: LineFriendshipStatus[]): {
    gateway: LineFriendshipGateway
    calls: UserId[]
  } {
    const responses: LineFriendshipStatus[] = [{ kind: 'not_friend' }, ...after]
    return stubFriendshipGateway(() => Promise.resolve(responses.shift() ?? { kind: 'not_friend' }))
  }

  it('登録時の照会に失敗していても、画面からの確認で友だち追加を記録して回復する', async () => {
    const stub = stubAfterRegistration([{ kind: 'friend' }])
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    const events = subscribeFriendAdded(t)
    await register(t)
    expect(await friendAddKindOf(t)).toBe('not_added')

    const res = await check(t)

    expect(res.status).toBe(200)
    const body = await json<CheckResponse>(res)
    expect(body.result.kind).toBe('confirmed')
    expect(body.user.common.lineOperationSettings?.friendAdd.kind).toBe('added')
    expect(await friendAddKindOf(t)).toBe('added')
    expect(events).toHaveLength(1)
  })

  it('まだ友だち追加されていなければ not_friend を返し、記録しない', async () => {
    const stub = stubAfterRegistration([{ kind: 'not_friend' }])
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    const events = subscribeFriendAdded(t)
    await register(t)

    const res = await check(t)

    expect(res.status).toBe(200)
    expect((await json<CheckResponse>(res)).result.kind).toBe('not_friend')
    // 照会したうえで友だちでなかったことを固定する（照会をやめても通る形にしない）
    expect(stub.calls).toEqual([VIEWER_ID, VIEWER_ID])
    expect(await friendAddKindOf(t)).toBe('not_added')
    expect(events).toHaveLength(0)
  })

  it('照会できなかった場合は unavailable を返す（友だち未追加として確定させない）', async () => {
    const stub = stubAfterRegistration([{ kind: 'unknown', detail: 'LINE profile API 500' }])
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await register(t)

    try {
      const res = await check(t)

      expect(res.status).toBe(200)
      expect((await json<CheckResponse>(res)).result.kind).toBe('unavailable')
      expect(await friendAddKindOf(t)).toBe('not_added')
      // 無言の握りつぶしと区別する（失敗の理由がログに出ること）
      expect(logged).toHaveBeenCalledTimes(1)
      expect(String(logged.mock.calls[0]?.[0])).toContain('LINE profile API 500')
    } finally {
      logged.mockRestore()
    }
  })

  it('照会が例外を投げても 5xx にせず unavailable を返す', async () => {
    // 登録時の照会は空振りさせ、画面からの確認だけを例外にする
    let calls = 0
    const stub = stubFriendshipGateway(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve({ kind: 'not_friend' })
        : Promise.reject(new Error('boom'))
    })
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    await register(t)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const res = await check(t)

      expect(res.status).toBe(200)
      expect((await json<CheckResponse>(res)).result.kind).toBe('unavailable')
      expect(await friendAddKindOf(t)).toBe('not_added')
      expect(logged).toHaveBeenCalledTimes(1)
    } finally {
      logged.mockRestore()
    }
  })

  it('記録済みなら照会せずに confirmed を返す（押すたびに外部 API を叩かない）', async () => {
    const stub = stubAfterRegistration([{ kind: 'friend' }])
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })
    await register(t)
    expect((await json<CheckResponse>(await check(t))).result.kind).toBe('confirmed')

    const res = await check(t)

    expect((await json<CheckResponse>(res)).result.kind).toBe('confirmed')
    // 登録時 + 回復した 1 回だけ。記録後の押下では照会しない
    expect(stub.calls).toEqual([VIEWER_ID, VIEWER_ID])
  })

  it('未登録のユーザーからの確認は 404', async () => {
    const stub = stubFriendshipGateway(() => Promise.resolve({ kind: 'friend' }))
    const t = createTestApp({ lineFriendshipGateway: stub.gateway })

    expect((await check(t)).status).toBe(404)
    // 登録していない相手の友だち状態を外部へ問い合わせない
    expect(stub.calls).toEqual([])
  })
})

describe('GET /api/onboarding/me', () => {
  it('未登録なら user: null', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/onboarding/me')
    expect(res.status).toBe(200)
    expect((await json<UserResponse>(res)).user).toBeNull()
  })

  it('登録後は自分の AppUser を返す', async () => {
    const t = createTestApp()
    await register(t)
    const res = await request(t.app, 'GET', '/api/onboarding/me')
    const body = await json<UserResponse>(res)
    expect(body.user?.common.userId).toBe(VIEWER_ID)
  })
})

describe('PUT /api/onboarding/nickname', () => {
  it('本人のニックネームを設定・解除できる', async () => {
    const t = createTestApp()
    await register(t)
    const set = await request(t.app, 'PUT', '/api/onboarding/nickname', {
      body: { nickname: 'はにー' },
    })
    expect(set.status).toBe(200)
    expect((await json<UserResponse>(set)).user?.common.nickname).toBe('はにー')

    const clear = await request(t.app, 'PUT', '/api/onboarding/nickname', {
      body: { nickname: null },
    })
    expect((await json<UserResponse>(clear)).user?.common.nickname).toBeUndefined()
  })

  it('11 文字以上は 400（Phase 3.5: ≤10 文字）', async () => {
    const t = createTestApp()
    await register(t)
    const res = await request(t.app, 'PUT', '/api/onboarding/nickname', {
      body: { nickname: 'あいうえおかきくけこさ' },
    })
    expect(res.status).toBe(400)
  })

  it('未登録ユーザーは 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'PUT', '/api/onboarding/nickname', {
      body: { nickname: 'はにー' },
    })
    expect(res.status).toBe(404)
  })
})

describe('Phase1 ステップの完了記録', () => {
  it('友だち追加 → トークルーム参加 → 通知有効化の順に記録できる', async () => {
    const t = createTestApp()
    await register(t)

    const friend = await request(t.app, 'POST', '/api/onboarding/phase1/line-friend')
    expect(friend.status).toBe(200)

    const room = await request(t.app, 'POST', '/api/onboarding/phase1/talk-room', {
      body: { talkRoomId: 'room_test_001' },
    })
    expect(room.status).toBe(200)

    const notification = await request(t.app, 'POST', '/api/onboarding/phase1/notification')
    expect(notification.status).toBe(200)

    const me = await request(t.app, 'GET', '/api/onboarding/me')
    const body = await json<{ user: AppUser; sharedTalkRoom: SharedTalkRoom }>(me)
    expect(body.user.common.lineOperationSettings?.friendAdd.kind).toBe('added')
    expect(body.user.common.lineOperationSettings?.notificationActivation.kind).toBe('activated')
    // 参加状態の「正」は世帯レベルの記録（OQ-55 ①）。per-user 側には持たない
    expect(body.sharedTalkRoom).toEqual({
      kind: 'joined',
      talkRoomId: 'room_test_001',
      joinWebhookReceivedAt: expect.any(String),
    })
    expect(body.user.common.lineOperationSettings).not.toHaveProperty('talkRoomJoin')
  })

  it('友だち追加・トークルーム参加前の通知有効化は 409', async () => {
    const t = createTestApp()
    await register(t)
    const res = await request(t.app, 'POST', '/api/onboarding/phase1/notification')
    expect(res.status).toBe(409)
  })

  it('友だち追加済みでも世帯が共通トークルーム未参加なら通知有効化は 409', async () => {
    const t = createTestApp()
    await register(t)
    expect((await request(t.app, 'POST', '/api/onboarding/phase1/line-friend')).status).toBe(200)
    const res = await request(t.app, 'POST', '/api/onboarding/phase1/notification')
    expect(res.status).toBe(409)
  })

  it('共通トークルーム参加は世帯で共有される（配偶者の記録が相方にも見える）', async () => {
    const t = createTestApp()
    await register(t)
    await request(t.app, 'POST', '/api/onboarding/phase1/talk-room', {
      body: { talkRoomId: 'room_test_001' },
    })

    // 配偶者（別 viewer）から見ても同じ世帯の参加記録が返る
    const me = await request(t.app, 'GET', '/api/onboarding/me', { viewerId: SPOUSE_ID })
    const body = await json<{ sharedTalkRoom: SharedTalkRoom }>(me)
    expect(body.sharedTalkRoom.kind).toBe('joined')
  })
})

describe('Phase2 進捗', () => {
  it('phase2/start で Phase2 進行中になる（再実行は冪等）', async () => {
    const t = createTestApp()
    await startPhase2(t)
    const again = await request(t.app, 'POST', '/api/onboarding/phase2/start')
    expect(again.status).toBe(200)
    expect((await json<UserResponse>(again)).user?.kind).toBe('phase2_in_progress')
  })

  it('SectionA 完了前の SectionB は 409（論点8: 順序強制）', async () => {
    const t = createTestApp()
    await startPhase2(t)
    const res = await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      body: { initialBalanceRef: INITIAL_BALANCE_REF },
    })
    expect(res.status).toBe(409)
  })

  it('OAuth コールバックで SectionA が完了し、SectionB に進める', async () => {
    const t = createTestApp()
    await seedInitialBalanceAccounts(t)
    await startPhase2(t)

    const callback = await completeSectionAViaOAuth(t)
    expect(callback.status).toBe(200)

    const me = await request(t.app, 'GET', '/api/onboarding/me')
    expect((await json<UserResponse>(me)).user?.progress?.sectionA.kind).toBe('completed')

    const sectionB = await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      body: { initialBalanceRef: INITIAL_BALANCE_REF },
    })
    expect(sectionB.status).toBe(200)
    expect((await json<UserResponse>(sectionB)).user?.progress?.sectionB.kind).toBe('completed')
  })

  it('SectionA 完了後でも参照先口座が実在しなければ SectionB は 404（初期残高未登録）', async () => {
    const t = createTestApp()
    // 口座を seed せず、実在しない initialBalanceRef を渡す
    await startPhase2(t)
    await completeSectionAViaOAuth(t)

    const res = await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      body: { initialBalanceRef: INITIAL_BALANCE_REF },
    })
    expect(res.status).toBe(404)

    // SectionB は完了扱いにならない（永続化前に中断される）
    const me = await request(t.app, 'GET', '/api/onboarding/me')
    expect((await json<UserResponse>(me)).user?.progress?.sectionB.kind).toBe('not_started')
  })

  it('一部の参照先口座のみ実在する場合も SectionB は 404', async () => {
    const t = createTestApp()
    await startPhase2(t)
    await completeSectionAViaOAuth(t)
    // NISA 口座だけ実在させ、SMBC・別銀行貯蓄は未登録のままにする
    await t.deps.accountRepository.save(
      registerNisaAccount({
        accountId: AccountIdSchema.parse(INITIAL_BALANCE_REF.nisaAccountId),
        ownerUserId: VIEWER_ID,
        brokerageName: BrokerageNameSchema.parse({ kind: 'sbi' }),
        initialAccumulated: money(200000),
        at: new Date('2026-01-01T00:00:00Z'),
      }),
    )

    const res = await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      body: { initialBalanceRef: INITIAL_BALANCE_REF },
    })
    expect(res.status).toBe(404)
  })

  it('参照先口座の種別が期待と異なる場合は SectionB は 404（種別不一致）', async () => {
    const t = createTestApp()
    await startPhase2(t)
    await completeSectionAViaOAuth(t)
    await seedInitialBalanceAccounts(t)
    // smbcAccountId に NISA 口座 ID を割り当て、期待種別（smbc_bank）と食い違わせる
    const res = await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      body: {
        initialBalanceRef: {
          ...INITIAL_BALANCE_REF,
          smbcAccountId: INITIAL_BALANCE_REF.nisaAccountId,
        },
      },
    })
    expect(res.status).toBe(404)
  })

  it('同一口座 ID を複数フィールドに重複指定した場合は SectionB は 404（種別不一致で弾く）', async () => {
    const t = createTestApp()
    await startPhase2(t)
    await completeSectionAViaOAuth(t)
    await seedInitialBalanceAccounts(t)
    // SMBC 口座 ID を 3 フィールド全てに指定 → 別銀行貯蓄・NISA 枠で種別不一致になる
    const res = await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      body: {
        initialBalanceRef: {
          smbcAccountId: INITIAL_BALANCE_REF.smbcAccountId,
          otherSavingsAccountId: INITIAL_BALANCE_REF.smbcAccountId,
          nisaAccountId: INITIAL_BALANCE_REF.smbcAccountId,
        },
      },
    })
    expect(res.status).toBe(404)
  })

  it('配偶者名義の別銀行貯蓄・NISA を参照した場合は SectionB は 404（所有者不一致・存在プロービング防止）', async () => {
    const t = createTestApp()
    await startPhase2(t) // VIEWER
    await completeSectionAViaOAuth(t)
    // VIEWER 本人名義の 3 口座と、配偶者名義の 3 口座を両方登録する
    await seedInitialBalanceAccounts(t, VIEWER_ID)
    await seedInitialBalanceAccounts(t, SPOUSE_ID)
    // SMBC は本人名義だが、別銀行貯蓄・NISA を配偶者名義の口座 ID に差し替える
    const spouseRef = initialBalanceRefFor(SPOUSE_ID)
    const res = await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      viewerId: VIEWER_ID,
      body: {
        initialBalanceRef: {
          smbcAccountId: INITIAL_BALANCE_REF.smbcAccountId,
          otherSavingsAccountId: spouseRef.otherSavingsAccountId,
          nisaAccountId: spouseRef.nisaAccountId,
        },
      },
    })
    expect(res.status).toBe(404)
  })

  it('配偶者名義の SMBC 銀行口座を参照した場合も SectionB は 404（SMBC も所有者照合の対象）', async () => {
    const t = createTestApp()
    await startPhase2(t) // VIEWER
    await completeSectionAViaOAuth(t)
    // VIEWER 本人名義の 3 口座と、配偶者名義の SMBC を登録する
    await seedInitialBalanceAccounts(t, VIEWER_ID)
    await seedSmbcAccount(t, SPOUSE_SMBC_ID, SPOUSE_ID)
    // SMBC だけ配偶者名義の口座 ID に差し替える（残高は本人のみ可視で秘匿性が最も高い。P2-B5）
    const res = await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      viewerId: VIEWER_ID,
      body: { initialBalanceRef: { ...INITIAL_BALANCE_REF, smbcAccountId: SPOUSE_SMBC_ID } },
    })
    expect(res.status).toBe(404)
  })

  it('改竄された state のコールバックは 403 で SectionA は完了しない', async () => {
    const t = createTestApp()
    await startPhase2(t)
    const res = await t.app.request('/oauth/gmail/callback?code=dummy&state=tampered.sig')
    expect(res.status).toBe(403)
    const me = await request(t.app, 'GET', '/api/onboarding/me')
    expect((await json<UserResponse>(me)).user?.progress?.sectionA.kind).toBe('not_started')
  })

  it('SectionF はスキップも完了も記録できる', async () => {
    const t = createTestApp()
    await startPhase2(t)
    const skip = await request(t.app, 'PUT', '/api/onboarding/phase2/section-f', {
      body: { kind: 'skipped' },
    })
    expect(skip.status).toBe(200)
    expect((await json<UserResponse>(skip)).user?.progress?.sectionF.kind).toBe('skipped')

    const complete = await request(t.app, 'PUT', '/api/onboarding/phase2/section-f', {
      body: { kind: 'completed', importJobId: '01HZZZZZZZZZZZZZZZZZZZZZ09' },
    })
    expect(complete.status).toBe(200)
    expect((await json<UserResponse>(complete)).user?.progress?.sectionF.kind).toBe('completed')
  })

  it('A/B 未完了の phase2/complete は 409、完了後は phase2_completed になる', async () => {
    const t = createTestApp()
    await seedInitialBalanceAccounts(t)
    await startPhase2(t)
    const premature = await request(t.app, 'POST', '/api/onboarding/phase2/complete')
    expect(premature.status).toBe(409)

    await completeSectionAViaOAuth(t)
    await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      body: { initialBalanceRef: INITIAL_BALANCE_REF },
    })
    const complete = await request(t.app, 'POST', '/api/onboarding/phase2/complete')
    expect(complete.status).toBe(201)
    expect((await json<UserResponse>(complete)).user?.kind).toBe('phase2_completed')
  })
})

/** 指定 viewer を Phase2 完了まで進める（口座 seed → Phase2 開始 → SectionA/B 完了 → 完了） */
async function completePhase2For(t: TestApp, viewerId: string): Promise<void> {
  const id = UserIdSchema.parse(viewerId)
  // 各 viewer 本人名義の 3 口座（SMBC・別銀行貯蓄・NISA）を先に登録しておく（所有者照合を満たすため）
  await seedInitialBalanceAccounts(t, id)
  await startPhase2(t, id)
  await completeSectionAViaOAuth(t, id)
  await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
    viewerId: id,
    body: { initialBalanceRef: initialBalanceRefFor(id) },
  })
  const res = await request(t.app, 'POST', '/api/onboarding/phase2/complete', { viewerId: id })
  expect(res.status).toBe(201)
}

describe('GET /api/onboarding/spouse-completion', () => {
  it('配偶者が未完了なら awaiting_spouse', async () => {
    const t = createTestApp()
    await completePhase2For(t, VIEWER_ID)
    const res = await request(t.app, 'GET', '/api/onboarding/spouse-completion')
    expect(res.status).toBe(200)
    const body = await json<{ kind: string; spouseUserId?: string }>(res)
    expect(body.kind).toBe('awaiting_spouse')
    expect(body.spouseUserId).toBe(SPOUSE_ID)
  })

  it('両者完了なら both_completed（夫婦はそれぞれ自分名義の 3 口座を参照する）', async () => {
    const t = createTestApp()
    await completePhase2For(t, VIEWER_ID)
    await completePhase2For(t, SPOUSE_ID)
    const res = await request(t.app, 'GET', '/api/onboarding/spouse-completion')
    const body = await json<{ kind: string; honeyUserId?: string; darlingUserId?: string }>(res)
    expect(body.kind).toBe('both_completed')
    expect(body.honeyUserId).toBe(VIEWER_ID)
    expect(body.darlingUserId).toBe(SPOUSE_ID)
  })
})

/**
 * 運用開始発火（08f §2、論点16）と世帯の通知機能有効化（テスト送信の起動）。
 * 「両者の Phase2 完了が揃った時点で一元発火する」ことと、片方だけでは発火しないことを固定する。
 */
describe('運用開始発火（OperationStarted / NotificationActivated）', () => {
  interface EventLog {
    operationStarted: OperationStarted[]
    notificationActivated: NotificationActivated[]
    testMessageSent: TestMessageSent[]
  }

  function subscribeOperationEvents(t: TestApp): EventLog {
    const log: EventLog = { operationStarted: [], notificationActivated: [], testMessageSent: [] }
    t.deps.eventBus.subscribe<OperationStarted>('OperationStarted', e => {
      log.operationStarted.push(e)
      return Promise.resolve()
    })
    t.deps.eventBus.subscribe<NotificationActivated>('NotificationActivated', e => {
      log.notificationActivated.push(e)
      return Promise.resolve()
    })
    t.deps.eventBus.subscribe<TestMessageSent>('TestMessageSent', e => {
      log.testMessageSent.push(e)
      return Promise.resolve()
    })
    return log
  }

  /** 通知機能有効化の前提（両者の友だち追加 + 世帯の共通トークルーム参加）だけを満たす */
  async function completeNotificationPrerequisites(t: TestApp): Promise<void> {
    for (const viewerId of [VIEWER_ID, SPOUSE_ID]) {
      await register(t, viewerId)
      expect(
        (await request(t.app, 'POST', '/api/onboarding/phase1/line-friend', { viewerId })).status,
      ).toBe(200)
    }
    expect(
      (
        await request(t.app, 'POST', '/api/onboarding/phase1/talk-room', {
          body: { talkRoomId: 'room_test_001' },
        })
      ).status,
    ).toBe(200)
  }

  async function userKindOf(t: TestApp, userId: UserId): Promise<string | undefined> {
    return (await t.deps.appUserRepository.findById(userId))?.kind
  }

  /** 共通トークルーム参加をリポジトリへ直接記録する（記録経由の発火を通さずに前提だけ整える） */
  async function seedJoinedTalkRoom(t: TestApp): Promise<void> {
    await t.deps.sharedTalkRoomRepository.save(
      recordSharedTalkRoomJoined(
        NOT_JOINED_SHARED_TALK_ROOM,
        TalkRoomIdSchema.parse('room_test_001'),
        new Date(),
      ),
    )
  }

  async function notificationActivationKindOf(t: TestApp, userId: UserId): Promise<string> {
    const user = await t.deps.appUserRepository.findById(userId)
    expect(user).not.toBeNull()
    return lineOperationSettingsOf(user!).notificationActivation.kind
  }

  it('片方のみ Phase2 完了では発火しない（否定形）', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    await completeNotificationPrerequisites(t)
    await completePhase2For(t, VIEWER_ID)

    // 配偶者完了検知（画面ロード）を挟んでも、相方が未完了である限り発火しない
    expect((await request(t.app, 'GET', '/api/onboarding/spouse-completion')).status).toBe(200)
    expect(log.operationStarted).toHaveLength(0)
    expect(log.notificationActivated).toHaveLength(0)
    expect(await userKindOf(t, VIEWER_ID)).toBe('phase2_completed')
  })

  it('両者の Phase2 完了が揃った時点で発火し、両者が運用開始済みになる', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    await completeNotificationPrerequisites(t)

    // 1 人目の完了応答は Phase2 完了のまま（この時点では発火しない）
    await seedInitialBalanceAccounts(t, VIEWER_ID)
    await startPhase2(t, VIEWER_ID)
    await completeSectionAViaOAuth(t, VIEWER_ID)
    await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      viewerId: VIEWER_ID,
      body: { initialBalanceRef: initialBalanceRefFor(VIEWER_ID) },
    })
    const first = await request(t.app, 'POST', '/api/onboarding/phase2/complete')
    expect(first.status).toBe(201)
    expect((await json<UserResponse>(first)).user?.kind).toBe('phase2_completed')
    expect(log.operationStarted).toHaveLength(0)

    // 2 人目の完了応答は発火後の状態（運用開始済み）を返す — web はこの応答で完了画面へ進む
    await seedInitialBalanceAccounts(t, SPOUSE_ID)
    await startPhase2(t, SPOUSE_ID)
    await completeSectionAViaOAuth(t, SPOUSE_ID)
    await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      viewerId: SPOUSE_ID,
      body: { initialBalanceRef: initialBalanceRefFor(SPOUSE_ID) },
    })
    const second = await request(t.app, 'POST', '/api/onboarding/phase2/complete', {
      viewerId: SPOUSE_ID,
    })
    expect(second.status).toBe(201)
    expect((await json<UserResponse>(second)).user?.kind).toBe('operation_started')

    expect(log.operationStarted).toHaveLength(1)
    expect(log.operationStarted[0]?.honeyUserId).toBe(VIEWER_ID)
    expect(log.operationStarted[0]?.darlingUserId).toBe(SPOUSE_ID)
    expect(await userKindOf(t, VIEWER_ID)).toBe('operation_started')
    expect(await userKindOf(t, SPOUSE_ID)).toBe('operation_started')
  })

  it('運用開始で世帯の通知機能が有効化され、テストメッセージが配信される', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    await completeNotificationPrerequisites(t)
    await completePhase2For(t, VIEWER_ID)
    await completePhase2For(t, SPOUSE_ID)

    expect(log.notificationActivated).toHaveLength(1)
    expect(log.notificationActivated[0]?.talkRoomId).toBe('room_test_001')
    // 既存のテストメッセージ配信ハンドラー（#36）が起動していること
    expect(log.testMessageSent).toHaveLength(1)
    expect(log.testMessageSent[0]?.talkRoomId).toBe('room_test_001')
  })

  it('発火後に検知・完了要求を繰り返しても二重発火しない（冪等）', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    await completeNotificationPrerequisites(t)
    await completePhase2For(t, VIEWER_ID)
    await completePhase2For(t, SPOUSE_ID)

    for (const viewerId of [VIEWER_ID, SPOUSE_ID]) {
      expect(
        (await request(t.app, 'GET', '/api/onboarding/spouse-completion', { viewerId })).status,
      ).toBe(200)
      const complete = await request(t.app, 'POST', '/api/onboarding/phase2/complete', { viewerId })
      expect(complete.status).toBe(200)
      expect((await json<UserResponse>(complete)).user?.kind).toBe('operation_started')
    }
    expect(log.operationStarted).toHaveLength(1)
    expect(log.notificationActivated).toHaveLength(1)
    expect(log.testMessageSent).toHaveLength(1)
  })

  it('共通トークルーム未参加なら運用開始はするが通知機能は有効化されない（否定形）', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await completePhase2For(t, VIEWER_ID)
      await completePhase2For(t, SPOUSE_ID)

      expect(log.operationStarted).toHaveLength(1)
      expect(log.notificationActivated).toHaveLength(0)
      expect(log.testMessageSent).toHaveLength(0)
      // per-user の有効化まで進んでいない（世帯として有効化されていない）
      expect(await notificationActivationKindOf(t, VIEWER_ID)).toBe('not_activated')
      // 無言で止まらず、何が欠けたのかが記録される
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('talk_room_not_joined'))
    } finally {
      warned.mockRestore()
    }
  })

  it('前提が後から揃えば、配偶者完了検知でも通知機能が有効化される（回復）', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (const viewerId of [VIEWER_ID, SPOUSE_ID]) {
        await register(t, viewerId)
        await request(t.app, 'POST', '/api/onboarding/phase1/line-friend', { viewerId })
      }
      await completePhase2For(t, VIEWER_ID)
      await completePhase2For(t, SPOUSE_ID)
      expect(log.operationStarted).toHaveLength(1)
      expect(log.notificationActivated).toHaveLength(0)

      // 記録は届いたが、その回の発火は行われなかった状況（発火の失敗など）を作る。
      // 参加記録をリポジトリへ直接置き、API 経由の発火の起点を通さない
      await seedJoinedTalkRoom(t)
      expect(log.notificationActivated).toHaveLength(0)

      expect((await request(t.app, 'GET', '/api/onboarding/spouse-completion')).status).toBe(200)
      expect(log.notificationActivated).toHaveLength(1)
      expect(log.testMessageSent).toHaveLength(1)
      expect(log.operationStarted).toHaveLength(1)
    } finally {
      warned.mockRestore()
    }
  })

  it('運用開始後に友だち追加が記録された時点で通知機能が有効化される（回復）', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // 相方だけ友だち追加済み・共通トークルーム参加済みの状態で運用開始させる
      for (const viewerId of [VIEWER_ID, SPOUSE_ID]) await register(t, viewerId)
      await request(t.app, 'POST', '/api/onboarding/phase1/line-friend', { viewerId: SPOUSE_ID })
      await request(t.app, 'POST', '/api/onboarding/phase1/talk-room', {
        body: { talkRoomId: 'room_test_001' },
      })
      await completePhase2For(t, VIEWER_ID)
      await completePhase2For(t, SPOUSE_ID)
      expect(log.operationStarted).toHaveLength(1)
      expect(log.notificationActivated).toHaveLength(0)

      // 運用開始後は web のセットアップ画面を離れるため、LINE 記録の到着が回復の起点になる
      expect((await request(t.app, 'POST', '/api/onboarding/phase1/line-friend')).status).toBe(200)
      expect(log.notificationActivated).toHaveLength(1)
      expect(log.testMessageSent).toHaveLength(1)
    } finally {
      warned.mockRestore()
    }
  })

  it('運用開始後に共通トークルームへ招待された時点で通知機能が有効化される（回復）', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (const viewerId of [VIEWER_ID, SPOUSE_ID]) {
        await register(t, viewerId)
        await request(t.app, 'POST', '/api/onboarding/phase1/line-friend', { viewerId })
      }
      await completePhase2For(t, VIEWER_ID)
      await completePhase2For(t, SPOUSE_ID)
      expect(log.notificationActivated).toHaveLength(0)

      const room = await request(t.app, 'POST', '/api/onboarding/phase1/talk-room', {
        body: { talkRoomId: 'room_test_001' },
      })
      expect(room.status).toBe(200)
      expect(log.notificationActivated).toHaveLength(1)
      expect(log.testMessageSent).toHaveLength(1)
    } finally {
      warned.mockRestore()
    }
  })

  it('世帯に登録されていない viewer の検知要求では発火しない（否定形）', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // 共通トークルーム未参加のまま運用開始させ、通知機能の有効化だけが未了の状態を作る
      for (const viewerId of [VIEWER_ID, SPOUSE_ID]) {
        await register(t, viewerId)
        await request(t.app, 'POST', '/api/onboarding/phase1/line-friend', { viewerId })
      }
      await completePhase2For(t, VIEWER_ID)
      await completePhase2For(t, SPOUSE_ID)
      // 参加記録はリポジトリへ直接置く（API 経由だとその記録自体が発火の起点になるため）
      await seedJoinedTalkRoom(t)
      expect(log.notificationActivated).toHaveLength(0)

      // 許可リストに無い LINE ユーザー（= アプリユーザー未登録）からの検知要求
      const stranger = await request(t.app, 'GET', '/api/onboarding/spouse-completion', {
        viewerId: UserIdSchema.parse('user-stranger'),
      })
      expect(stranger.status).toBe(200)
      expect(log.notificationActivated).toHaveLength(0)
      expect(log.testMessageSent).toHaveLength(0)

      // 世帯のメンバーからの検知要求では発火する（発火経路そのものが死んでいないことの確認）
      expect((await request(t.app, 'GET', '/api/onboarding/spouse-completion')).status).toBe(200)
      expect(log.notificationActivated).toHaveLength(1)
      expect(log.testMessageSent).toHaveLength(1)
    } finally {
      warned.mockRestore()
    }
  })

  it('運用開始後の通知有効化要求でも、世帯としての有効化は一元発火に委ねられる', async () => {
    const t = createTestApp()
    const log = subscribeOperationEvents(t)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // 相方（Darling）だけ Phase1 の通知有効化まで済ませてから運用開始させる
      await completeNotificationPrerequisites(t)
      expect(
        (
          await request(t.app, 'POST', '/api/onboarding/phase1/notification', {
            viewerId: SPOUSE_ID,
          })
        ).status,
      ).toBe(200)
      // 事前蓄積（Phase1）の有効化そのものは世帯イベントを出さない
      expect(log.notificationActivated).toHaveLength(0)
      await completePhase2For(t, VIEWER_ID)
      await completePhase2For(t, SPOUSE_ID)
      expect(log.notificationActivated).toHaveLength(1)

      // 本人の有効化要求を後から出しても、既に世帯として有効化済みのため二重発火しない
      const res = await request(t.app, 'POST', '/api/onboarding/phase1/notification')
      expect(res.status).toBe(200)
      expect(log.notificationActivated).toHaveLength(1)
      expect(log.testMessageSent).toHaveLength(1)
    } finally {
      warned.mockRestore()
    }
  })
})
