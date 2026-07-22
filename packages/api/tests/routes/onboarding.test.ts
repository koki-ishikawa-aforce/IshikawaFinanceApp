import { describe, it, expect } from 'vitest'
import {
  AccountIdSchema,
  AccountSchema,
  BankNameSchema,
  BrokerageNameSchema,
  UserIdSchema,
  money,
  registerNisaAccount,
  registerOtherSavingsAccount,
} from '@warimaru/domain'
import type { AppUser, UserId } from '@warimaru/domain'
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

const INITIAL_BALANCE_REF = {
  smbcAccountId: '01HZZZZZZZZZZZZZZZZZZZZZ01',
  otherSavingsAccountId: '01HZZZZZZZZZZZZZZZZZZZZZ02',
  nisaAccountId: '01HZZZZZZZZZZZZZZZZZZZZZ03',
}

/**
 * SectionB の事前条件「初期残高が登録された」を満たすため、INITIAL_BALANCE_REF が指す
 * 3 口座（SMBC 銀行・別銀行貯蓄・NISA）を残高・資産推移管理コンテキストに先に登録しておく。
 * 参照整合チェックは実在のみを見る（所有者は問わない）ため、同一 REF を夫婦双方が参照できる。
 */
async function seedInitialBalanceAccounts(t: TestApp, ownerId: UserId = VIEWER_ID): Promise<void> {
  const at = new Date('2026-01-01T00:00:00Z')
  await t.deps.accountRepository.save(
    AccountSchema.parse({
      kind: 'smbc_bank',
      common: {
        accountId: INITIAL_BALANCE_REF.smbcAccountId,
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
  await t.deps.accountRepository.save(
    registerOtherSavingsAccount({
      accountId: AccountIdSchema.parse(INITIAL_BALANCE_REF.otherSavingsAccountId),
      ownerUserId: ownerId,
      bankName: BankNameSchema.parse('楽天銀行'),
      initialBalance: money(500000),
      at,
    }),
  )
  await t.deps.accountRepository.save(
    registerNisaAccount({
      accountId: AccountIdSchema.parse(INITIAL_BALANCE_REF.nisaAccountId),
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
    const user = (await json<{ user: AppUser }>(me)).user
    expect(user.common.lineOperationSettings?.friendAdd.kind).toBe('added')
    expect(user.common.lineOperationSettings?.talkRoomJoin.kind).toBe('joined')
    expect(user.common.lineOperationSettings?.notificationActivation.kind).toBe('activated')
  })

  it('友だち追加・トークルーム参加前の通知有効化は 409', async () => {
    const t = createTestApp()
    await register(t)
    const res = await request(t.app, 'POST', '/api/onboarding/phase1/notification')
    expect(res.status).toBe(409)
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

describe('GET /api/onboarding/spouse-completion', () => {
  async function completePhase2For(t: TestApp, viewerId: string): Promise<void> {
    const id = UserIdSchema.parse(viewerId)
    await startPhase2(t, id)
    await completeSectionAViaOAuth(t, id)
    await request(t.app, 'PUT', '/api/onboarding/phase2/section-b', {
      viewerId: id,
      body: { initialBalanceRef: INITIAL_BALANCE_REF },
    })
    const res = await request(t.app, 'POST', '/api/onboarding/phase2/complete', { viewerId: id })
    expect(res.status).toBe(201)
  }

  it('配偶者が未完了なら awaiting_spouse', async () => {
    const t = createTestApp()
    await seedInitialBalanceAccounts(t)
    await completePhase2For(t, VIEWER_ID)
    const res = await request(t.app, 'GET', '/api/onboarding/spouse-completion')
    expect(res.status).toBe(200)
    const body = await json<{ kind: string; spouseUserId?: string }>(res)
    expect(body.kind).toBe('awaiting_spouse')
    expect(body.spouseUserId).toBe(SPOUSE_ID)
  })

  it('両者完了なら both_completed', async () => {
    const t = createTestApp()
    await seedInitialBalanceAccounts(t)
    await completePhase2For(t, VIEWER_ID)
    await completePhase2For(t, SPOUSE_ID)
    const res = await request(t.app, 'GET', '/api/onboarding/spouse-completion')
    const body = await json<{ kind: string; honeyUserId?: string; darlingUserId?: string }>(res)
    expect(body.kind).toBe('both_completed')
    expect(body.honeyUserId).toBe(VIEWER_ID)
    expect(body.darlingUserId).toBe(SPOUSE_ID)
  })
})
