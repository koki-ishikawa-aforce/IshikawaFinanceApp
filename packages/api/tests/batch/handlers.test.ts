/**
 * バッチの Lambda ハンドラー（#416）のテスト。
 *
 * ハンドラーは EventBridge から呼ばれる本番の入口そのものなので、ジョブを直に呼ばずに
 * ハンドラー越しに検証する（イベントの読み取り・上限時間・失敗の翻訳まで通す）。
 * 依存はモック合成（`createTestApp`）で、Gmail 取得とパースだけ差し替える。
 *
 * 押さえるのは 3 つ:
 *  - 起動: スケジュールから呼ぶと各ワーカーが世帯ぶん動く
 *  - 失敗: 戻り値の失敗が握りつぶされず、例外として外（Lambda の失敗）へ出る
 *  - 上限時間: 返ってこない処理を自分で打ち切り、記録してから失敗させる
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  GmailMessageIdSchema,
  GmailOAuthTokenSchema,
  ParameterStorePathSchema,
  SmbcMailParseResultSchema,
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
  createCsvImportReminderHandler,
  createDailyMailImportHandler,
  createMonthlyExpenseCycleStartHandler,
} from '../../src/batch/handlers.js'
import type { AppDeps } from '../../src/composition-root.js'
import { createTestApp, SPOUSE_ID, VIEWER_ID, type TestApp } from '../helpers/test-app.js'

/** 2026-08-01 00:00 JST（月初の起動）を UTC で表したもの — 月の導出がずれないかを見る */
const MONTH_START_EVENT_TIME = '2026-07-31T15:00:00Z'
const AT = new Date('2026-08-10T00:00:00+09:00')

afterEach(() => {
  vi.restoreAllMocks()
})

function mailBody(id: string): SmbcNotificationMailBody {
  return {
    gmailMessageId: GmailMessageIdSchema.parse(id),
    receivedAt: new Date('2026-08-09T12:34:00+09:00'),
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
    occurredAt: new Date('2026-08-09T12:34:00+09:00'),
    cardKind: 'mitsui_sumitomo',
  })

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

function loaderOf(deps: AppDeps): () => Promise<AppDeps> {
  return () => Promise.resolve(deps)
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
    expect(summary.outcomes.every(line => line.includes('status=completed'))).toBe(true)
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

  it('取込に失敗した人がいれば失敗として投げる（もう一方の取込は済ませてから）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    // 相方は Gmail 未連携 — 連携が切れている限りカード利用は家計簿に出てこないため、
    // 黙って成功にせず失敗として上げる
    await authorizeGmail(t, VIEWER_ID)
    const gateway = fetchGateway([mailBody('gmail-1')])
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({
        ...t.deps,
        gmailMailFetchGateway: gateway,
        parseSmbcNotificationMail: cardUsageParser,
      }),
    })

    await expect(handler({ time: '2026-08-10T00:00:00Z' })).rejects.toThrow(/daily-mail-import/)
    expect(gateway.requests.map(r => r.userId)).toEqual([VIEWER_ID])
  })

  it('失敗の記録にユーザーID を載せない', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    const handler = createDailyMailImportHandler({
      loadDeps: loaderOf({ ...t.deps, gmailMailFetchGateway: fetchGateway([]) }),
    })

    await expect(handler({ time: '2026-08-10T00:00:00Z' })).rejects.toSatisfy(
      (e: Error) => !e.message.includes(VIEWER_ID),
    )
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

  it('開始に失敗した人がいれば失敗として投げる（もう一方は開始してから）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const repository = t.deps.appUserRepository
    const findByRole = repository.findByRole.bind(repository)
    vi.spyOn(repository, 'findByRole').mockImplementation((role: UserRole) =>
      role === 'darling' ? Promise.reject(new Error('接続できない')) : findByRole(role),
    )
    const handler = createMonthlyExpenseCycleStartHandler({ loadDeps: loaderOf(t.deps) })

    await expect(handler({ time: MONTH_START_EVENT_TIME })).rejects.toThrow(
      /monthly-expense-cycle-start/,
    )
    expect(
      await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(
        VIEWER_ID,
        YearMonthSchema.parse('2026-08'),
      ),
    ).not.toBeNull()
  })
})

describe('CSV 取込リマインダーハンドラー', () => {
  it('当月 5 日より前の起動では配信しない（失敗にもしない）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const handler = createCsvImportReminderHandler({ loadDeps: loaderOf(t.deps) })

    const summary = await handler({ time: '2026-08-02T00:00:00+09:00' })

    expect(summary.job).toBe('csv-import-reminder')
    expect(summary.outcomes).toEqual(['targetMonth=2026-08 outcome=before_start_day'])
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

  it('Lambda の残り時間が上限より短ければ、そちらに合わせて打ち切る', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = createDailyMailImportHandler({
      loadDeps: () => new Promise<AppDeps>(() => {}),
      timeoutMs: 10 * 60 * 1000,
    })

    // 残り時間 - 余裕（5 秒）= 10ms で打ち切られる。上限をそのまま使うとテストは終わらない
    await expect(
      handler({ time: '2026-08-10T00:00:00Z' }, { getRemainingTimeInMillis: () => 5_010 }),
    ).rejects.toThrow(/timed out/)
  })
})
