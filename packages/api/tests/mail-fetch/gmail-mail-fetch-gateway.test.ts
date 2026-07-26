/**
 * GmailMailFetchGateway（Gmail API 実装、#412）の単体テスト
 *
 * HTTP はモックする。確かめたいのは「Gmail の応答をどう外部表現へ翻訳するか」と
 * 「失敗をトークン失効とその他のどちらに倒すか」の 2 点。
 * 失効を取り違えると、通信断のたびにユーザーへ再認可を求めるか（#392 の空振り）、
 * 逆に本当に失効しているのに毎日空振りし続けて取込が止まったままになる。
 *
 * 本文・件名の fixture は ISO-2022-JP（#415 の実メール調査で確定した charset）で符号化した
 * バイト列を base64 / base64url で持つ。UTF-8 前提で読むとエスケープシーケンスが残るため、
 * デコード経路を実際に通すにはこの形でないと検証にならない。
 */
import { describe, it, expect, vi } from 'vitest'
import { NotFoundError, ParameterStorePathSchema } from '@warimaru/domain'
import { createGmailMailFetchGateway } from '../../src/mail-fetch/gmail-mail-fetch-gateway.js'

const TOKEN_REF = ParameterStorePathSchema.parse('/warimaru/gmail-oauth/Udarling-0001')
const PERIOD = {
  from: new Date('2026-07-20T00:00:00Z'),
  to: new Date('2026-07-25T00:00:00Z'),
}

/** `ご利用のお知らせ【三井住友カード】`（ISO-2022-JP） */
const CARD_SUBJECT_B64 = 'GyRCJDRNeE1RJE4kKkNOJGkkOyFaOzAwZj07TSclKyE8JUkhWxsoQg=='
/** 送信元表示名 `三井住友カード`（ISO-2022-JP） */
const CARD_DISPLAY_NAME_B64 = 'GyRCOzAwZj07TSclKyE8JUkbKEI='
/** カード利用通知の text/plain 本文（ISO-2022-JP、base64url） */
const CARD_BODY_B64URL =
  'GyRCQFBAbhsoQiAbJEJNTRsoQgoKGyRCJCQkRCRiOzAwZj07TSclKyE8JUkkciQ0TXhNUUQ6JC0kIiRqJCwkSCQmJDQkNiQkJF4kOSEjGyhCCgobJEIhfk14TVFGfCEnGyhCMjAyNi8wNy8xNSAxNDozNwobJEIhfk14TVFAaCEnGyhCQU1BWk9OIENPIEpQChskQiF-TXhNUTxoMHohJ0djSiobKEIKGyRCIX5NeE1RNmIzWyEnGyhCMiw0MjAbJEIxXxsoQgo'
/** `【三井住友銀行】振込入金のお知らせ`（ISO-2022-JP） */
const BANK_SUBJECT_B64 = 'GyRCIVo7MDBmPTtNJzZkOVQhWz82OX5GfjZiJE4kKkNOJGkkOxsoQg=='
/** 振込入金通知の text/plain 本文（ISO-2022-JP、base64url） */
const BANK_BODY_B64URL =
  'GyRCJSQlNyUrJW8bKEIgGyRCJTMlJiUtJDUkXhsoQgoKGyRCRn42YkZ8GyhCIBskQiEnGyhCIDIwMjYbJEJHLxsoQjA3GyRCN24bKEIxMxskQkZ8GyhCChskQjZiM1sbKEIgIBskQiEnGyhCIDMwLDAxNBskQjFfGyhCChskQkZiTUYbKEIgIBskQiEnGyhCIBskQj82OX4lNSE8JVMlORsoQiAbJEIlKCUkGyhCIBskQiVVJSohPCU5GyhCKBskQiUrGyhCCg'

const encodedWord = (b64: string): string => `=?ISO-2022-JP?B?${b64}?=`

/** カード利用通知（multipart/alternative + text/plain / text/html。#415 の実メールの形） */
function cardUsageMessage(id = 'msg-card-1'): unknown {
  return {
    id,
    internalDate: '1752571020000',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: `${encodedWord(CARD_DISPLAY_NAME_B64)} <statement@vpass.ne.jp>` },
        { name: 'Subject', value: encodedWord(CARD_SUBJECT_B64) },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          headers: [{ name: 'Content-Type', value: 'text/plain; charset="iso-2022-jp"' }],
          body: { data: CARD_BODY_B64URL },
        },
        {
          mimeType: 'text/html',
          headers: [{ name: 'Content-Type', value: 'text/html; charset="iso-2022-jp"' }],
          body: { data: 'PGh0bWw-PC9odG1sPg' },
        },
      ],
    },
  }
}

/** 振込入金通知（multipart/signed の入れ子。S/MIME 署名付きで届く） */
function bankDepositMessage(id = 'msg-bank-1'): unknown {
  return {
    id,
    internalDate: '1752375960000',
    payload: {
      mimeType: 'multipart/signed',
      headers: [
        { name: 'From', value: '三井住友銀行 <SMBC_service@dn.smbc.co.jp>' },
        { name: 'Subject', value: encodedWord(BANK_SUBJECT_B64) },
      ],
      parts: [
        {
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'text/plain',
              headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-2022-jp' }],
              body: { data: BANK_BODY_B64URL },
            },
          ],
        },
        {
          mimeType: 'application/pkcs7-signature',
          filename: 'smime.p7s',
          body: { data: 'AAAA' },
        },
      ],
    },
  }
}

function amazonMessage(id = 'msg-amazon-1'): unknown {
  return {
    id,
    internalDate: '1752300000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Amazon.co.jp <auto-confirm@amazon.co.jp>' },
        { name: 'Subject', value: 'Amazon.co.jp ご注文の確認' },
        { name: 'Content-Type', value: 'text/plain; charset="utf-8"' },
      ],
      body: { data: Buffer.from('ご注文の確認', 'utf-8').toString('base64url') },
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

interface Stub {
  /** トークン更新の応答。既定は成功 */
  token?: Response
  /** 検索の応答（ページ順） */
  pages?: unknown[]
  /** メッセージ ID → 応答 */
  messages?: Record<string, unknown>
  /** メッセージ取得を強制的に置き換える（エラー系の検証用） */
  messageResponse?: Response
}

function stubFetch(stub: Stub): typeof fetch {
  const pages = [...(stub.pages ?? [])]
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return stub.token ?? jsonResponse({ access_token: 'access-token-1' })
    }
    if (url.includes('/messages?')) {
      return jsonResponse(pages.shift() ?? { messages: [] })
    }
    if (stub.messageResponse !== undefined) return stub.messageResponse
    const id = decodeURIComponent(url.split('/messages/')[1]?.split('?')[0] ?? '')
    return jsonResponse(stub.messages?.[id] ?? {})
  }) as unknown as typeof fetch
}

function gatewayWith(
  fetchImpl: typeof fetch,
  overrides: { resolveTokenJson?: (path: string) => Promise<string>; maxMessages?: number } = {},
): ReturnType<typeof createGmailMailFetchGateway> {
  return createGmailMailFetchGateway({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    resolveTokenJson:
      overrides.resolveTokenJson ??
      (() => Promise.resolve(JSON.stringify({ refresh_token: 'refresh-token-1' }))),
    fetchImpl,
    timeoutMs: 50,
    ...(overrides.maxMessages === undefined ? {} : { maxMessages: overrides.maxMessages }),
  })
}

describe('GmailMailFetchGateway（取得と翻訳）', () => {
  it('取込対象期間と対象送信元で Gmail 側に絞り込ませる', async () => {
    const fetchImpl = stubFetch({ pages: [{ messages: [] }] })

    await gatewayWith(fetchImpl).fetchMails({ tokenStoreRef: TOKEN_REF, period: PERIOD })

    const searchCall = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls
      .map(([url]) => url)
      .find(url => url.includes('/messages?'))
    const query = decodeURIComponent(new URL(searchCall ?? '').searchParams.get('q') ?? '')
    expect(query).toContain('from:statement@vpass.ne.jp')
    expect(query).toContain('from:smbc_service@dn.smbc.co.jp')
    expect(query).toContain('from:amazon.co.jp')
    // epoch 秒。日付指定だとタイムゾーンで境界が 1 日ずれる
    expect(query).toContain(`after:${Math.floor(PERIOD.from.getTime() / 1000)}`)
    expect(query).toContain(`before:${Math.floor(PERIOD.to.getTime() / 1000)}`)
  })

  it('カード利用通知の件名と ISO-2022-JP 本文を復元し、種別ヒントを付ける', async () => {
    const fetchImpl = stubFetch({
      pages: [{ messages: [{ id: 'msg-card-1' }] }],
      messages: { 'msg-card-1': cardUsageMessage() },
    })

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails).toHaveLength(1)
    const mail = result.smbcMails[0]
    expect(mail?.gmailMessageId).toBe('msg-card-1')
    expect(mail?.subject).toBe('ご利用のお知らせ【三井住友カード】')
    expect(mail?.kindHint).toBe('card_usage')
    expect(mail?.receivedAt).toEqual(new Date(1752571020000))
    // パース（#415）が読む行がそのまま復元されていること
    expect(mail?.body).toContain('◇利用先：AMAZON CO JP')
    expect(mail?.body).toContain('◇利用金額：2,420円')
    expect(result.amazonMails).toHaveLength(0)
  })

  it('multipart/signed の入れ子からも text/plain 本文を取り出す（銀行通知は S/MIME 署名付き）', async () => {
    const fetchImpl = stubFetch({
      pages: [{ messages: [{ id: 'msg-bank-1' }] }],
      messages: { 'msg-bank-1': bankDepositMessage() },
    })

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails[0]?.kindHint).toBe('bank_deposit')
    expect(result.smbcMails[0]?.body).toContain('金額  ： 30,014円')
  })

  it('Amazon 注文確認メールは送信元ドメインで別のリストへ振り分ける', async () => {
    const fetchImpl = stubFetch({
      pages: [{ messages: [{ id: 'msg-amazon-1' }, { id: 'msg-card-1' }] }],
      messages: { 'msg-amazon-1': amazonMessage(), 'msg-card-1': cardUsageMessage() },
    })

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.amazonMails.map(m => m.gmailMessageId)).toEqual(['msg-amazon-1'])
    expect(result.smbcMails.map(m => m.gmailMessageId)).toEqual(['msg-card-1'])
  })

  it('対象外の送信元から届いたメールは取り込まない', async () => {
    const spoofed = {
      id: 'msg-spoof-1',
      internalDate: '1752300000000',
      payload: {
        mimeType: 'text/plain',
        headers: [
          // 表示名に対象アドレスを含むが、実アドレスは別（`from:` 検索は表示名にも当たる）
          { name: 'From', value: 'statement@vpass.ne.jp <attacker@example.com>' },
          { name: 'Subject', value: 'ご利用のお知らせ【三井住友カード】' },
        ],
        body: { data: Buffer.from('偽の通知', 'utf-8').toString('base64url') },
      },
    }
    const fetchImpl = stubFetch({
      pages: [{ messages: [{ id: 'msg-spoof-1' }] }],
      messages: { 'msg-spoof-1': spoofed },
    })

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails).toHaveLength(0)
    expect(result.amazonMails).toHaveLength(0)
  })

  it('件名が既知のどれとも一致しなければ種別ヒントは unknown（パース側に委ねる）', async () => {
    const unknownSubject = {
      id: 'msg-card-2',
      internalDate: '1752300000000',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: '<statement@vpass.ne.jp>' },
          { name: 'Subject', value: 'キャンペーンのお知らせ' },
        ],
        body: { data: Buffer.from('本文', 'utf-8').toString('base64url') },
      },
    }
    const fetchImpl = stubFetch({
      pages: [{ messages: [{ id: 'msg-card-2' }] }],
      messages: { 'msg-card-2': unknownSubject },
    })

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails[0]?.kindHint).toBe('unknown')
  })

  it('本文パートが無いメールも捨てずに本文空で返す（取り込めなかった事実を消さない）', async () => {
    const noBody = {
      id: 'msg-card-3',
      internalDate: '1752300000000',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: '<statement@vpass.ne.jp>' },
          { name: 'Subject', value: 'ご利用のお知らせ【三井住友カード】' },
        ],
        parts: [{ mimeType: 'application/pdf', filename: 'a.pdf', body: { data: 'AAAA' } }],
      },
    }
    const fetchImpl = stubFetch({
      pages: [{ messages: [{ id: 'msg-card-3' }] }],
      messages: { 'msg-card-3': noBody },
    })

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails).toHaveLength(1)
    expect(result.smbcMails[0]?.body).toBe('')
  })

  it('検索結果が複数ページに分かれても全ページを辿る', async () => {
    const fetchImpl = stubFetch({
      pages: [
        { messages: [{ id: 'msg-card-1' }], nextPageToken: 'page-2' },
        { messages: [{ id: 'msg-bank-1' }] },
      ],
      messages: { 'msg-card-1': cardUsageMessage(), 'msg-bank-1': bankDepositMessage() },
    })

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails.map(m => m.gmailMessageId)).toEqual(['msg-card-1', 'msg-bank-1'])
  })

  it('件数が上限を超えたら黙って打ち切らずに失敗を返す', async () => {
    const ids = Array.from({ length: 3 }, (_, i) => ({ id: `msg-${i}` }))
    const fetchImpl = stubFetch({ pages: [{ messages: ids }] })

    const result = await gatewayWith(fetchImpl, { maxMessages: 2 }).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('other_fetch_failure')
    expect(result.failure.detail).toContain('上限')
  })
})

describe('GmailMailFetchGateway（トークン失効の判別）', () => {
  it('refresh token が失効していれば oauth_revocation_detected を返す', async () => {
    const fetchImpl = stubFetch({
      token: new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    })

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('oauth_revocation_detected')
  })

  it('保管トークンに refresh token が無ければ失効として扱う（再認可でしか回復しない）', async () => {
    const fetchImpl = stubFetch({})

    const result = await gatewayWith(fetchImpl, {
      resolveTokenJson: () => Promise.resolve(JSON.stringify({ access_token: 'only-access' })),
    }).fetchMails({ tokenStoreRef: TOKEN_REF, period: PERIOD })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('oauth_revocation_detected')
  })

  it('トークンが保管されていなければ失効として扱う', async () => {
    const fetchImpl = stubFetch({})

    const result = await gatewayWith(fetchImpl, {
      resolveTokenJson: () => Promise.reject(new NotFoundError('ParameterStoreValue', 'path')),
    }).fetchMails({ tokenStoreRef: TOKEN_REF, period: PERIOD })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('oauth_revocation_detected')
  })

  it('Gmail API の 401 は失効として扱う', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('https://oauth2.googleapis.com/token')
        ? jsonResponse({ access_token: 'access-token-1' })
        : new Response('', { status: 401 }),
    ) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('oauth_revocation_detected')
  })

  it('スコープ不足の 403 は失効、レート制限の 403 はその他の失敗（やり直しで直る）として区別する', async () => {
    const with403 = (body: string): typeof fetch =>
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).startsWith('https://oauth2.googleapis.com/token')
          ? jsonResponse({ access_token: 'access-token-1' })
          : new Response(body, { status: 403 }),
      ) as unknown as typeof fetch

    const scope = await gatewayWith(
      with403(JSON.stringify({ error: { errors: [{ reason: 'insufficientPermissions' }] } })),
    ).fetchMails({ tokenStoreRef: TOKEN_REF, period: PERIOD })
    expect(scope.ok).toBe(false)
    if (scope.ok) return
    expect(scope.failure.kind).toBe('oauth_revocation_detected')

    const rateLimit = await gatewayWith(
      with403(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } })),
    ).fetchMails({ tokenStoreRef: TOKEN_REF, period: PERIOD })
    expect(rateLimit.ok).toBe(false)
    if (rateLimit.ok) return
    expect(rateLimit.failure.kind).toBe('other_fetch_failure')
    expect(rateLimit.failure).toMatchObject({ retryable: true })
  })
})

describe('GmailMailFetchGateway（その他の取得失敗）', () => {
  it('Gmail API の 5xx はやり直しで直りうる失敗として返す', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('https://oauth2.googleapis.com/token')
        ? jsonResponse({ access_token: 'access-token-1' })
        : new Response('', { status: 503 }),
    ) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: true })
  })

  it('Gmail API の 400 はやり直しても直らない失敗として返す', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('https://oauth2.googleapis.com/token')
        ? jsonResponse({ access_token: 'access-token-1' })
        : new Response('', { status: 400 }),
    ) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: false })
  })

  it('通信断は失効と取り違えず、やり直しで直りうる失敗として返す', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'access-token-1' })
      }
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: true })
  })

  it('失敗の詳細にトークン保管先パス・メールアドレスを載せない（そのままログに出るため）', async () => {
    const fetchImpl = stubFetch({
      token: new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    })

    const result = await gatewayWith(fetchImpl).fetchMails({
      tokenStoreRef: TOKEN_REF,
      period: PERIOD,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.detail).not.toContain(TOKEN_REF)
    expect(result.failure.detail).not.toContain('@')
  })
})
