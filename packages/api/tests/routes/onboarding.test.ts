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
import type { AppUser, SharedTalkRoom, UserId } from '@warimaru/domain'
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

describe('GET /api/onboarding/spouse-completion', () => {
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
