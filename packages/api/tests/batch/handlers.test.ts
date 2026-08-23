/**
 * バッチの Lambda ハンドラー（#416）のテスト。
 *
 * ハンドラーは EventBridge から呼ばれる本番の入口そのものなので、ジョブを直に呼ばずに
 * ハンドラー越しに検証する（イベントの読み取り・上限時間・失敗の翻訳まで通す）。
 * 依存はモック合成（`createTestApp`）で、Gmail 取得とパースだけ差し替える。
 *
 * 押さえるのは 4 つ:
 *  - 起動: スケジュールから呼ぶと各ワーカーが世帯ぶん動く
 *  - 結末: 要約に載る件数が実際の取込結果と一致する（この行が唯一の記録になる）
 *  - 失敗: 戻り値の失敗が握りつぶされず、例外として外（Lambda の失敗）へ出る。
 *    かつ 1 人の失敗が他方の処理を巻き込まない（失敗する役割を先・後の両方で確かめる）
 *  - 上限時間: 返ってこない処理を自分で打ち切り、記録してから失敗させる
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  GmailMessageIdSchema,
  GmailOAuthTokenSchema,
  ParameterStorePathSchema,
  SmbcMailParseResultSchema,
  TransactionCandidateSchema,
  YearMonthSchema,
  money,
  registerAppUser,
} from '@warimaru/domain'
import type {
  GmailMailFetchGateway,
  MailFetchRequest,
  MailFetchResult,
  SmbcNotificationMailBody,
  SmbcNotificationMailParser,
  UserId,
  UserRole,
} from '@warimaru/domain'
import {
  batchTimeoutMsFromEnv,
  createCsvImportReminderHandler,
  createDailyMailImportHandler,
  createMonthlyExpenseCycleStartHandler,
  DEFAULT_BATCH_TIMEOUT_MS,
} from '../../src/batch/handlers.js'
import type { AppDeps } from '../../src/composition-root.js'
import { createTestApp, SPOUSE_ID, VIEWER_ID, type TestApp } from '../helpers/test-app.js'

/** 2026-08-01 00:00 JST（月初の起動）を UTC で表したもの — 月の導出がずれないかを見る */
const MONTH_START_EVENT_TIME = '2026-07-31T15:00:00Z'
const AT = new Date('2026-08-10T00:00:00+09:00')
const OCCURRED_AT = new Date('2026-08-09T12:34:00+09:00')

afterEach(() => {
  vi.restoreAllMocks()
})

function mailBody(id: string): SmbcNotificationMailBody {
  return {
    gmailMessageId: GmailMessageIdSchema.parse(id),
    receivedAt: OCCURRED_AT,
    subject: 'ご利用のお知らせ【三井住友カード】',
    body: '本文',
    kindHint: 'card_usage',
  }
}

/** 取得成功を返す Gmail 取得（呼び出し内容も検証できるよう記録する） */
function fetchGateway(
  mails: SmbcNotificationMailBody[],
): GmailMailFetchGateway & { requests: MailFetchRequest[] } {
  const requests: MailFetchRequest[] = []
  return {
    requests,
    fetchMails: (request: MailFetchRequest): Promise<MailFetchResult> => {
      requests.push(request)
      return Promise.resolve({ ok: true, smbcMails: mails, amazonMails: [] })
    },
  }
}

/** カード利用としてパースするスタブ（実パースルールは #415） */
const cardUsageParser: SmbcNotificationMailParser = ({ mail, userId }) =>
  SmbcMailParseResultSchema.parse({
    kind: 'card_usage',
    gmailMessageId: mail.gmailMessageId,
    userId,
    merchantName: 'スーパーA',
    amount: money(1200),
    occurredAt: OCCURRED_AT,
    cardKind: 'mitsui_sumitomo',
  })

/** 指定した Gmail message ID だけパース失敗にするスタブ（件数の内訳を作るため） */
function parserFailingFor(failingIds: string[]): SmbcNotificationMailParser {
  return params =>
    failingIds.includes(params.mail.gmailMessageId)
      ? SmbcMailParseResultSchema.parse({
          kind: 'parse_failure',
          gmailMessageId: params.mail.gmailMessageId,
          reason: 'garbled_text',
          detectedAt: params.at,
        })
      : cardUsageParser(params)
}

async function registerHousehold(t: TestApp): Promise<void> {
  await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
  await t.deps.appUserRepository.save(registerAppUser(SPOUSE_ID, 'darling', undefined, AT))
}

async function authorizeGmail(t: TestApp, userId: UserId): Promise<void> {
  await t.deps.gmailOAuthTokenRepository.save(
    GmailOAuthTokenSchema.parse({
      kind: 'valid',
      userId,
      tokenStoreRef: ParameterStorePathSchema.parse(`/warimaru/gmail/${userId}`),
      authorizedAt: AT,
      lastVerifiedAt: AT,
    }),
  )
}

/** Gmail 連携が失効検知済みの状態にする（再認可されるまで取り込めない） */
async function revokeGmail(t: TestApp, userId: UserId): Promise<void> {
  await t.deps.gmailOAuthTokenRepository.save(
    GmailOAuthTokenSchema.parse({
      kind: 'revocation_detected',
      userId,
      tokenStoreRef: ParameterStorePathSchema.parse(`/warimaru/gmail/${userId}`),
      authorizedAt: AT,
      revocationDetectedAt: AT,
      revocationReason: 'expired',
    }),
  )
}

function loaderOf(deps: AppDeps): () => Promise<AppDeps> {
  return () => Promise.resolve(deps)
}

/** 役割ごとの結末行（`role=honey status=...`）を取り出す */
function outcomeOf(outcomes: string[], role: UserRole): string | undefined {
  return outcomes.find(line => line.startsWith(`role=${role} `))
}

describe('日次メール取込ハンドラー', () => {
  it('スケジュール起動で世帯の全員ぶんの取込が動く', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    await authorizeGmail(t, VIEWER_ID)
    await authorizeGmail(t, SPOUSE_ID)
    const gateway = fetchGateway([mailBody('gmail-1')])
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({
        ...t.deps,
        gmailMailFetchGateway: gateway,
        parseSmbcNotificationMail: cardUsageParser,
      }),
    })

    const summary = await handler({ time: '2026-08-10T00:00:00Z', detail: {} })

    expect(summary.job).toBe('daily-mail-import')
    expect(summary.at).toBe('2026-08-10T00:00:00.000Z')
    expect(gateway.requests.map(r => r.userId).sort()).toEqual([SPOUSE_ID, VIEWER_ID].sort())
    expect(summary.outcomes).toHaveLength(2)
  })

  it('結末の要約に取込・重複除外・パース失敗の件数がそのまま載る', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    await authorizeGmail(t, VIEWER_ID)
    // 既に取り込んである 1 通（重複除外の対象になる）
    await t.deps.transactionCandidateRepository.save(
      TransactionCandidateSchema.parse({
        kind: 'normal',
        common: {
          transactionCandidateId: '01CAN000000000000000000001',
          userId: VIEWER_ID,
          importSource: { kind: 'email', gmailMessageId: 'gmail-dup' },
          merchantName: '既に取り込んだ店',
          amount: money(999),
          occurredAt: OCCURRED_AT,
        },
      }),
    )
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({
        ...t.deps,
        gmailMailFetchGateway: fetchGateway([
          mailBody('gmail-new'),
          mailBody('gmail-dup'),
          mailBody('gmail-broken'),
        ]),
        parseSmbcNotificationMail: parserFailingFor(['gmail-broken']),
      }),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const summary = await handler({ time: '2026-08-10T00:00:00Z' })

    expect(outcomeOf(summary.outcomes, 'honey')).toMatch(
      /^role=honey status=completed imported=1 duplicate=1 failed=1 other=0 importBatchId=\S+$/,
    )
  })

  it('detail のさかのぼり日数が取込に渡る', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    await authorizeGmail(t, VIEWER_ID)
    const gateway = fetchGateway([])
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({
        ...t.deps,
        gmailMailFetchGateway: gateway,
        parseSmbcNotificationMail: cardUsageParser,
      }),
    })

    await handler({ time: '2026-08-10T00:00:00Z', detail: { scanDays: 1 } })

    expect(gateway.requests[0]?.period.from).toEqual(new Date('2026-08-09T00:00:00Z'))
  })

  it('未登録のユーザーは失敗に数えない（オンボーディング前は取込対象が居ないだけ）', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    await authorizeGmail(t, VIEWER_ID)
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({
        ...t.deps,
        gmailMailFetchGateway: fetchGateway([]),
        parseSmbcNotificationMail: cardUsageParser,
      }),
    })

    const summary = await handler({ time: '2026-08-10T00:00:00Z' })

    expect(outcomeOf(summary.outcomes, 'darling')).toBe('role=darling status=not_registered')
  })

  it('Gmail 未連携の人がいれば、取込を起動しなくても失敗として投げる（連携が切れている限り家計簿に出てこないため）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    await authorizeGmail(t, VIEWER_ID)
    const gateway = fetchGateway([mailBody('gmail-1')])
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({
        ...t.deps,
        gmailMailFetchGateway: gateway,
        parseSmbcNotificationMail: cardUsageParser,
      }),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler({ time: '2026-08-10T00:00:00Z' })).rejects.toMatchObject({
      name: 'ScheduledJobFailedError',
      message: expect.stringContaining('status=not_launched reason=not_linked'),
    })
    expect(gateway.requests.map(r => r.userId)).toEqual([VIEWER_ID])
  })

  it('Gmail が失効している人も失敗として投げる（未連携と同じく取り込まれない日が続くため）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    await authorizeGmail(t, VIEWER_ID)
    await revokeGmail(t, SPOUSE_ID)
    const gateway = fetchGateway([mailBody('gmail-1')])
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({
        ...t.deps,
        gmailMailFetchGateway: gateway,
        parseSmbcNotificationMail: cardUsageParser,
      }),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler({ time: '2026-08-10T00:00:00Z' })).rejects.toMatchObject({
      name: 'ScheduledJobFailedError',
      message: expect.stringContaining('status=not_launched reason=revocation_detected'),
    })
    expect(gateway.requests.map(r => r.userId)).toEqual([VIEWER_ID])
  })

  it('常態の対象外と新しく起きた失敗を、要約の内訳行で見分けられる', async () => {
    // 片方が未連携の世帯では毎日必ず赤になる。内訳が無いと、そこに通信断が 1 件混ざっても
    // アラート本文を読み比べないと分からない
    const t = createTestApp()
    await registerHousehold(t)
    await authorizeGmail(t, VIEWER_ID)
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({
        ...t.deps,
        gmailMailFetchGateway: {
          fetchMails: () =>
            Promise.resolve({
              ok: false,
              failure: {
                kind: 'other_fetch_failure',
                detail: 'Gmail API がタイムアウトした（list）',
                detectedAt: AT,
                retryable: true,
              },
            }),
        },
        parseSmbcNotificationMail: cardUsageParser,
      }),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler({ time: '2026-08-10T00:00:00Z' })).rejects.toMatchObject({
      name: 'ScheduledJobFailedError',
      summary: {
        outcomes: expect.arrayContaining(['内訳: not_launched=1 failed=1']),
      },
    })
  })

  it('先に処理される人が落ちても、もう一方の取込は完了する', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    await authorizeGmail(t, SPOUSE_ID)
    const repository = t.deps.appUserRepository
    const findByRole = repository.findByRole.bind(repository)
    // honey は UserRole の先頭。取込の手続きそのものが落ちる経路（結末以前の失敗）を作る
    vi.spyOn(repository, 'findByRole').mockImplementation((role: UserRole) =>
      role === 'honey' ? Promise.reject(new Error('接続できない')) : findByRole(role),
    )
    const gateway = fetchGateway([mailBody('gmail-1')])
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({
        ...t.deps,
        gmailMailFetchGateway: gateway,
        parseSmbcNotificationMail: cardUsageParser,
      }),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler({ time: '2026-08-10T00:00:00Z' })).rejects.toMatchObject({
      name: 'ScheduledJobFailedError',
      message: expect.stringContaining('role=honey status=failed error=Error'),
    })
    expect(gateway.requests.map(r => r.userId)).toEqual([SPOUSE_ID])
  })

  it('失敗の記録にユーザーID を載せない（要約・ログとも）', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({ ...t.deps, gmailMailFetchGateway: fetchGateway([]) }),
    })

    await expect(handler({ time: '2026-08-10T00:00:00Z' })).rejects.toMatchObject({
      name: 'ScheduledJobFailedError',
      message: expect.not.stringContaining(VIEWER_ID),
    })
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).toContain('status=not_launched reason=not_linked')
    expect(logged).not.toContain(VIEWER_ID)
  })
})

describe('月次経費サイクル開始ハンドラー', () => {
  it('月初の起動で夫婦それぞれの当月サイクルが開始される', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const handler = createMonthlyExpenseCycleStartHandler({ loadDeps: loaderOf(t.deps) })

    const summary = await handler({ time: MONTH_START_EVENT_TIME, detail: {} })

    // UTC ではまだ 7 月だが、対象は JST 暦の 8 月でなければならない
    expect(summary.outcomes).toContain('targetYearMonth=2026-08')
    expect(summary.outcomes).toContain('role=honey status=started')
    expect(summary.outcomes).toContain('role=darling status=started')
  })

  it('同じ月に再実行してもサイクルは増えない', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const handler = createMonthlyExpenseCycleStartHandler({ loadDeps: loaderOf(t.deps) })

    await handler({ time: MONTH_START_EVENT_TIME })
    const summary = await handler({ time: MONTH_START_EVENT_TIME })

    expect(summary.outcomes).toContain('role=honey status=already_started')
    expect(summary.outcomes).toContain('role=darling status=already_started')
  })

  it('detail の対象年月を指定すると、その月のサイクルを開始する', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const handler = createMonthlyExpenseCycleStartHandler({ loadDeps: loaderOf(t.deps) })

    const summary = await handler({
      time: MONTH_START_EVENT_TIME,
      detail: { targetYearMonth: '2026-06' },
    })

    expect(summary.outcomes).toContain('targetYearMonth=2026-06')
  })

  it.each([
    { failing: 'honey', succeeding: 'darling', succeedingId: SPOUSE_ID },
    { failing: 'darling', succeeding: 'honey', succeedingId: VIEWER_ID },
  ] as const)(
    '$failing の開始が落ちても $succeeding のサイクルは開始され、失敗として投げる',
    async ({ failing, succeedingId }) => {
      const t = createTestApp()
      await registerHousehold(t)
      const repository = t.deps.appUserRepository
      const findByRole = repository.findByRole.bind(repository)
      vi.spyOn(repository, 'findByRole').mockImplementation((role: UserRole) =>
        role === failing ? Promise.reject(new Error('接続できない')) : findByRole(role),
      )
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const handler = createMonthlyExpenseCycleStartHandler({ loadDeps: loaderOf(t.deps) })

      await expect(handler({ time: MONTH_START_EVENT_TIME })).rejects.toMatchObject({
        name: 'ScheduledJobFailedError',
        message: expect.stringContaining(`role=${failing} status=failed`),
      })
      expect(
        await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(
          succeedingId,
          YearMonthSchema.parse('2026-08'),
        ),
      ).not.toBeNull()
    },
  )
})

describe('CSV 取込リマインダーハンドラー', () => {
  it('当月 5 日より前の起動では配信しない（失敗にもしない）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = createCsvImportReminderHandler({ loadDeps: loaderOf(t.deps) })

    const summary = await handler({ time: '2026-08-02T00:00:00+09:00' })

    expect(summary.job).toBe('csv-import-reminder')
    expect(summary.outcomes).toEqual(['targetMonth=2026-08 outcome=before_start_day'])
  })

  it('配信期間中は配信先の解決まで進む（依存の組み立てを通る）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = createCsvImportReminderHandler({ loadDeps: loaderOf(t.deps) })

    // 共通トークルーム未参加なので配信先が決まらない = 期間判定の先まで進んだ証拠
    const summary = await handler({ time: '2026-08-10T00:00:00+09:00' })

    expect(summary.outcomes).toEqual(['targetMonth=2026-08 outcome=target_unresolved'])
  })
})

describe('起動イベントの拒否', () => {
  it('書式が不正なイベントでは依存の合成にも進まない', async () => {
    const loadDeps = vi.fn(() => Promise.reject(new Error('呼ばれてはいけない')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = createDailyMailImportHandler({ loadDeps })

    await expect(handler({ detail: { targetMonth: '2026-08' } })).rejects.toMatchObject({
      name: 'InvalidScheduledBatchEventError',
    })
    expect(loadDeps).not.toHaveBeenCalled()
  })

  it('どのジョブの起動が弾かれたかをログに残す', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = createMonthlyExpenseCycleStartHandler({
      loadDeps: () => Promise.reject(new Error('呼ばれてはいけない')),
    })

    await expect(handler({ detail: { scanDays: 0 } })).rejects.toThrow()
    expect(error.mock.calls.flat().join(' ')).toContain('monthly-expense-cycle-start')
  })
})

describe('上限時間', () => {
  it('返ってこない処理は打ち切って失敗させる', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = createDailyMailImportHandler({
      loadDeps: () => new Promise<AppDeps>(() => {}),
      timeoutMs: 5,
    })

    await expect(handler({ time: '2026-08-10T00:00:00Z' })).rejects.toThrow(/timed out/)
    expect(error.mock.calls.flat().join(' ')).toContain('上限時間に達した')
  })

  it.each([
    { remaining: 3_600_000, expected: 600_000, why: '残り時間に余裕があれば設定した上限を使う' },
    { remaining: 300_000, expected: 295_000, why: '残り時間から余裕（5 秒）を引いた値まで縮める' },
    { remaining: 5_010, expected: 1_000, why: '残りがわずかでも 1 秒は待つ' },
  ])('$why', async ({ remaining, expected }) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = createDailyMailImportHandler({
      loadDeps: () => Promise.reject(new Error('合成させない')),
      timeoutMs: 600_000,
    })

    await expect(
      handler({ time: '2026-08-10T00:00:00Z' }, { getRemainingTimeInMillis: () => remaining }),
    ).rejects.toThrow('合成させない')
    expect(info.mock.calls.flat().join(' ')).toContain(`timeoutMs=${expected}`)
  })
})

describe('batchTimeoutMsFromEnv', () => {
  it('正の整数はそのまま使う', () => {
    expect(batchTimeoutMsFromEnv('60000')).toBe(60000)
  })

  it('未設定なら既定値に委ねる', () => {
    expect(batchTimeoutMsFromEnv(undefined)).toBeUndefined()
  })

  it.each(['0', '-1', '1.5', 'abc', ''])(
    '正の整数でない値は既定値に委ね、設定が効いていないことを警告する: "%s"',
    value => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(batchTimeoutMsFromEnv(value)).toBeUndefined()
      expect(warn.mock.calls.flat().join(' ')).toContain(String(DEFAULT_BATCH_TIMEOUT_MS))
    },
  )
})
