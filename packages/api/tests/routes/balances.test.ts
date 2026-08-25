import { describe, it, expect, vi } from 'vitest'
import type { AccountBalanceQuery, AccountDetailQuery } from '@warimaru/domain'
import { createTestApp, request, SPOUSE_ID } from '../helpers/test-app.js'

describe('GET /api/balances', () => {
  it('口座残高一覧ビューを返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([])
  })

  // 一覧は本人のみ可視（P2-B5 / AT-404）。閲覧者を渡し損ねると相手の口座まで並ぶため、
  // 呼び出し側がヘッダーの利用者をそのまま Query に渡していることを固定する。
  // あわせて、相手の合計を含む View を欠けなく返すことも押さえる（落とすと画面が
  // 一覧ごと取得エラーになる）
  it('リクエストの利用者を閲覧者として Query に渡し、View を欠けなく返す', async () => {
    const view = {
      items: [
        {
          kind: 'smbc_bank',
          accountId: 'ACC_1',
          displayName: '三井住友銀行',
          currentBalance: 1500000,
          lastUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
      spouseOtherSavingsAndNisaTotal: 260000,
    }
    const fetchBalanceList = vi
      .fn<AccountBalanceQuery['fetchBalanceList']>()
      .mockResolvedValue(
        view as unknown as Awaited<ReturnType<AccountBalanceQuery['fetchBalanceList']>>,
      )
    const t = createTestApp({
      accountBalanceQuery: {
        fetchBalanceList,
        fetchAssetTotal: vi.fn(),
      } as unknown as AccountBalanceQuery,
    })

    const res = await request(t.app, 'GET', '/api/balances', { viewerId: SPOUSE_ID })

    expect(fetchBalanceList).toHaveBeenCalledWith(SPOUSE_ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      items: [
        {
          kind: 'smbc_bank',
          accountId: 'ACC_1',
          displayName: '三井住友銀行',
          currentBalance: 1500000,
          lastUpdatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      spouseOtherSavingsAndNisaTotal: 260000,
    })
  })
})

describe('GET /api/balances/total', () => {
  it('asOf 未指定は現在時刻で資産総額を返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/total')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { asOf: string; total: number }
    expect(body.total).toBe(0)
    expect(new Date(body.asOf).getTime()).not.toBeNaN()
  })

  it('asOf 指定はその時点として渡される', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/total?asOf=2026-07-01T00:00:00.000Z')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { asOf: string }).asOf).toBe('2026-07-01T00:00:00.000Z')
  })

  it('asOf が日付として解釈できなければ 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/total?asOf=not-a-date')
    expect(res.status).toBe(400)
  })

  // 資産合計は世帯フルオープンで絞り込まないが、規約どおり閲覧者を Query に渡す
  // ことは固定する（#541）。渡し忘れて「引数が無いから絞らない」に戻さないため
  it('リクエストの利用者を閲覧者として Query に渡す', async () => {
    const fetchAssetTotal = vi.fn<AccountBalanceQuery['fetchAssetTotal']>().mockResolvedValue({
      asOf: new Date('2026-07-01T00:00:00.000Z'),
      smbcBalance: 0,
      otherSavingsBalance: 0,
      nisaContributionAccumulated: 0,
      cardUnpaidTotal: 0,
      total: 0,
    } as unknown as Awaited<ReturnType<AccountBalanceQuery['fetchAssetTotal']>>)
    const t = createTestApp({
      accountBalanceQuery: {
        fetchBalanceList: vi.fn(),
        fetchAssetTotal,
      } as unknown as AccountBalanceQuery,
    })

    const res = await request(t.app, 'GET', '/api/balances/total?asOf=2026-07-01T00:00:00.000Z', {
      viewerId: SPOUSE_ID,
    })

    expect(res.status).toBe(200)
    expect(fetchAssetTotal).toHaveBeenCalledWith(SPOUSE_ID, new Date('2026-07-01T00:00:00.000Z'))
  })
})

describe('GET /api/balances/time-series', () => {
  it('from〜to の期間で推移ビューを返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/time-series?from=2026-01&to=2026-07')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { yearMonthRange: { from: string; to: string } }
    expect(body.yearMonthRange).toEqual({ from: '2026-01', to: '2026-07' })
  })

  it('to 未指定は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/time-series?from=2026-01')
    expect(res.status).toBe(400)
  })

  it('from が不正な形式なら 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/time-series?from=202601&to=2026-07')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/balances/accounts/:accountId（口座詳細 #406）', () => {
  const ACCOUNT_ID = '01JZ0000000000000000000001'

  it('リクエストの利用者を閲覧者として Query に渡し、View を欠けなく返す', async () => {
    // 閲覧者を渡し損ねると他人の口座まで開けるため、そのまま渡していることを固定する
    const view = {
      accountId: ACCOUNT_ID,
      kind: 'other_savings',
      displayName: '楽天銀行',
      isActive: true,
      currentValue: 1740000,
      lastUpdatedAt: new Date('2026-06-14T00:00:00.000Z'),
      supportsBalanceManualEntry: true,
      yearMonthRange: { from: '2026-02', to: '2026-07' },
      series: [{ date: new Date('2026-06-14T00:00:00.000Z'), amount: 1740000 }],
      history: [
        {
          occurredAt: new Date('2026-06-14T00:00:00.000Z'),
          valueAfter: 1740000,
          delta: 40000,
          source: 'manual_correction',
          memo: '通帳を見て入れ直した',
        },
      ],
    }
    const fetch = vi
      .fn<AccountDetailQuery['fetch']>()
      .mockResolvedValue(view as unknown as Awaited<ReturnType<AccountDetailQuery['fetch']>>)
    const t = createTestApp({ accountDetailQuery: { fetch } as unknown as AccountDetailQuery })

    const res = await request(
      t.app,
      'GET',
      `/api/balances/accounts/${ACCOUNT_ID}?from=2026-02&to=2026-07`,
      { viewerId: SPOUSE_ID },
    )

    expect(fetch).toHaveBeenCalledWith(SPOUSE_ID, ACCOUNT_ID, '2026-02', '2026-07')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      accountId: ACCOUNT_ID,
      displayName: '楽天銀行',
      supportsBalanceManualEntry: true,
      history: [{ delta: 40000, source: 'manual_correction', memo: '通帳を見て入れ直した' }],
    })
  })

  it('見えない口座（Query が null）は 404 で、残高も口座名も本文に出さない', async () => {
    const t = createTestApp()
    const res = await request(
      t.app,
      'GET',
      `/api/balances/accounts/${ACCOUNT_ID}?from=2026-02&to=2026-07`,
    )

    expect(res.status).toBe(404)
    const body = await res.text()
    expect(body).not.toContain('楽天銀行')
    expect(body).not.toContain('1740000')
  })

  it('口座IDが ULID でなければ 400', async () => {
    const t = createTestApp()
    const res = await request(
      t.app,
      'GET',
      '/api/balances/accounts/not-a-ulid?from=2026-02&to=2026-07',
    )
    expect(res.status).toBe(400)
  })

  it('to 未指定は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', `/api/balances/accounts/${ACCOUNT_ID}?from=2026-02`)
    expect(res.status).toBe(400)
  })

  it('期間が上限（24 か月）を超えたら 400（履歴 1 件 = 1 行を無制限に返さない）', async () => {
    const t = createTestApp()
    const res = await request(
      t.app,
      'GET',
      `/api/balances/accounts/${ACCOUNT_ID}?from=2024-01&to=2026-07`,
    )
    expect(res.status).toBe(400)
  })
})
