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
import { NotFoundError, ParameterStorePathSchema, UserIdSchema } from '@warimaru/domain'
import {
  createGmailMailFetchGateway,
  createUnconfiguredGmailMailFetchGateway,
} from '../../src/mail-fetch/gmail-mail-fetch-gateway.js'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const TOKEN_REF = ParameterStorePathSchema.parse('/warimaru/gmail-oauth/Udarling-0001')
const USER_ID = UserIdSchema.parse('Udarling-0001')
const REFRESH_TOKEN = 'refresh-token-1'
const ACCESS_TOKEN = 'access-token-1'
const PERIOD = {
  from: new Date('2026-07-20T00:00:00Z'),
  to: new Date('2026-07-25T00:00:00Z'),
}
const REQUEST = { userId: USER_ID, tokenStoreRef: TOKEN_REF, period: PERIOD }

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
function cardUsageMessage(overrides: { subject?: string } = {}): unknown {
  return {
    id: 'msg-card-1',
    internalDate: '1752571020000',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: `${encodedWord(CARD_DISPLAY_NAME_B64)} <statement@vpass.ne.jp>` },
        { name: 'Subject', value: overrides.subject ?? encodedWord(CARD_SUBJECT_B64) },
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
function bankDepositMessage(): unknown {
  return {
    id: 'msg-bank-1',
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

function amazonMessage(): unknown {
  return {
    id: 'msg-amazon-1',
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

/** 送信元だけを差し替えた最小のメール（送信元判定の検証用） */
function messageFrom(id: string, from: string): unknown {
  return {
    id,
    internalDate: '1752300000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: 'ご利用のお知らせ【三井住友カード】' },
        { name: 'Content-Type', value: 'text/plain; charset="utf-8"' },
      ],
      body: { data: Buffer.from('本文', 'utf-8').toString('base64url') },
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

interface Call {
  url: string
  init?: RequestInit | undefined
}

interface Stub {
  /** トークン更新の応答。リクエストボディを見て返す形も取れる */
  token?: Response | ((body: string) => Response)
  /** pageToken（初回は空文字）→ 検索応答 */
  pages?: Record<string, unknown>
  /** メッセージ ID → 応答（`Response` をそのまま置くとエラー応答を作れる） */
  messages?: Record<string, unknown>
}

/**
 * Gmail をスタブする。**検索は `pageToken` をキーに引く**ので、実装が次ページのトークンを
 * 送らなければ同じページが返り、ページングのテストが素通りしない。
 */
function stubGmail(stub: Stub): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.startsWith(TOKEN_ENDPOINT)) {
      const body = String(init?.body ?? '')
      if (typeof stub.token === 'function') return stub.token(body)
      return stub.token ?? jsonResponse({ access_token: ACCESS_TOKEN })
    }
    if (url.includes('/messages?')) {
      const pageToken = new URL(url).searchParams.get('pageToken') ?? ''
      const page = stub.pages?.[pageToken]
      if (page === undefined) return jsonResponse({ messages: [] })
      return page instanceof Response ? page : jsonResponse(page)
    }
    const id = decodeURIComponent(url.split('/messages/')[1]?.split('?')[0] ?? '')
    const message = stub.messages?.[id]
    if (message === undefined) return new Response('', { status: 500 })
    return message instanceof Response ? message : jsonResponse(message)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function gatewayWith(
  fetchImpl: typeof fetch,
  overrides: {
    resolveTokenJson?: (path: string) => Promise<string>
    maxMessages?: number
  } = {},
): ReturnType<typeof createGmailMailFetchGateway> {
  return createGmailMailFetchGateway({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    resolveTokenJson:
      overrides.resolveTokenJson ??
      (() => Promise.resolve(JSON.stringify({ refresh_token: REFRESH_TOKEN }))),
    fetchImpl,
    timeoutMs: 50,
    ...(overrides.maxMessages === undefined ? {} : { maxMessages: overrides.maxMessages }),
  })
}

const searchCalls = (calls: Call[]): Call[] => calls.filter(c => c.url.includes('/messages?'))
const messageCalls = (calls: Call[]): Call[] =>
  calls.filter(c => c.url.includes('/messages/') && !c.url.includes('/messages?'))

describe('GmailMailFetchGateway（取得と翻訳）', () => {
  it('取込対象期間と対象送信元で Gmail 側に絞り込ませる', async () => {
    const { fetchImpl, calls } = stubGmail({ pages: { '': { messages: [] } } })

    await gatewayWith(fetchImpl).fetchMails(REQUEST)

    const query = decodeURIComponent(
      new URL(searchCalls(calls)[0]?.url ?? '').searchParams.get('q') ?? '',
    )
    expect(query).toContain('from:statement@vpass.ne.jp')
    expect(query).toContain('from:smbc_service@dn.smbc.co.jp')
    expect(query).toContain('from:amazon.co.jp')
    // epoch 秒のリテラルで固定する（秒/ミリ秒の取り違えを実装と同じ式で見逃さないため）
    expect(query).toContain('after:1784505600')
    expect(query).toContain('before:1784937600')
  })

  it('該当メールが 0 件でも成功として返す（毎日の空振りを失敗にしない）', async () => {
    const { fetchImpl } = stubGmail({ pages: { '': { messages: [] } } })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result).toEqual({ ok: true, smbcMails: [], amazonMails: [] })
  })

  it('保管された refresh token でアクセストークンを更新し、それを Gmail 呼び出しに使う', async () => {
    const { fetchImpl, calls } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }] } },
      messages: { 'msg-card-1': cardUsageMessage() },
    })
    const resolveTokenJson = vi.fn(() =>
      Promise.resolve(
        JSON.stringify({ access_token: '期限切れの古いトークン', refresh_token: REFRESH_TOKEN }),
      ),
    )

    await gatewayWith(fetchImpl, { resolveTokenJson }).fetchMails(REQUEST)

    expect(resolveTokenJson).toHaveBeenCalledWith(TOKEN_REF)
    const tokenBody = String(calls.find(c => c.url.startsWith(TOKEN_ENDPOINT))?.init?.body ?? '')
    expect(tokenBody).toContain('grant_type=refresh_token')
    expect(tokenBody).toContain(`refresh_token=${REFRESH_TOKEN}`)
    // 保管済みの access_token は 1 時間で切れるため使い回さない
    for (const call of [...searchCalls(calls), ...messageCalls(calls)]) {
      expect((call.init?.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      )
    }
  })

  it('カード利用通知の件名と ISO-2022-JP 本文を復元し、種別ヒントを付ける', async () => {
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }] } },
      messages: { 'msg-card-1': cardUsageMessage() },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

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

  it('分割された encoded-word の件名も 1 つに繋いで種別ヒントを判定する', async () => {
    // 長い日本語件名は複数の encoded-word に分かれて届く。間の空白は仕様どおり落とさないと
    // 件名が一致せず、種別ヒントが unknown に落ちる
    const subject = `${encodedWord('GyRCJDRNeE1RJE4kKkNOJGkkOxsoQg==')} ${encodedWord('GyRCIVo7MDBmPTtNJyUrITwlSSFbGyhC')}`
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }] } },
      messages: { 'msg-card-1': cardUsageMessage({ subject }) },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails[0]?.subject).toBe('ご利用のお知らせ【三井住友カード】')
    expect(result.smbcMails[0]?.kindHint).toBe('card_usage')
  })

  it('multipart/signed の入れ子からも text/plain 本文を取り出す（銀行通知は S/MIME 署名付き）', async () => {
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-bank-1' }] } },
      messages: { 'msg-bank-1': bankDepositMessage() },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails[0]?.kindHint).toBe('bank_deposit')
    expect(result.smbcMails[0]?.body).toContain('金額  ： 30,014円')
  })

  it('Amazon 注文確認メールは送信元ドメインで別のリストへ振り分ける', async () => {
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-amazon-1' }, { id: 'msg-card-1' }] } },
      messages: { 'msg-amazon-1': amazonMessage(), 'msg-card-1': cardUsageMessage() },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.amazonMails.map(m => m.gmailMessageId)).toEqual(['msg-amazon-1'])
    expect(result.smbcMails.map(m => m.gmailMessageId)).toEqual(['msg-card-1'])
  })

  it.each([
    ['表示名に対象アドレスを置いた From', 'statement@vpass.ne.jp <attacker@example.com>'],
    [
      '引用符付き表示名に対象アドレスを埋めた From',
      '"attacker@example.com <statement@vpass.ne.jp>" <evil@example.com>',
    ],
    ['アドレス部が複数ある From', 'x <statement@vpass.ne.jp> <evil@example.com>'],
    ['アドレスの形をしていない From', 'amazon.co.jp'],
  ])('%s は対象送信元と認めない（偽の通知を家計簿に入れない）', async (_name, from) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-spoof-1' }] } },
      messages: { 'msg-spoof-1': messageFrom('msg-spoof-1', from) },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails).toHaveLength(0)
    expect(result.amazonMails).toHaveLength(0)
    // 捨てたことが記録に残る（送信元の形が変わったときに黙って取りこぼし続けないため）
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('件名が既知のどれとも一致しなければ種別ヒントは unknown（パース側に委ねる）', async () => {
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }] } },
      messages: { 'msg-card-1': cardUsageMessage({ subject: 'キャンペーンのお知らせ' }) },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

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
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-3' }] } },
      messages: { 'msg-card-3': noBody },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails).toHaveLength(1)
    expect(result.smbcMails[0]?.body).toBe('')
  })
})

describe('GmailMailFetchGateway（ページングと件数）', () => {
  it('次ページのトークンを送って全ページを辿り、最後のページで止まる', async () => {
    const { fetchImpl, calls } = stubGmail({
      pages: {
        '': { messages: [{ id: 'msg-card-1' }], nextPageToken: 'page-2' },
        'page-2': { messages: [{ id: 'msg-bank-1' }] },
      },
      messages: { 'msg-card-1': cardUsageMessage(), 'msg-bank-1': bankDepositMessage() },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails.map(m => m.gmailMessageId)).toEqual(['msg-card-1', 'msg-bank-1'])
    expect(searchCalls(calls)).toHaveLength(2)
    expect(new URL(searchCalls(calls)[1]?.url ?? '').searchParams.get('pageToken')).toBe('page-2')
  })

  it('件数が上限ちょうどなら成功する', async () => {
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }, { id: 'msg-bank-1' }] } },
      messages: { 'msg-card-1': cardUsageMessage(), 'msg-bank-1': bankDepositMessage() },
    })

    const result = await gatewayWith(fetchImpl, { maxMessages: 2 }).fetchMails(REQUEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails).toHaveLength(2)
  })

  it('件数が上限を超えたら黙って打ち切らずに失敗を返す', async () => {
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } },
    })

    const result = await gatewayWith(fetchImpl, { maxMessages: 2 }).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: false })
    expect(result.failure.detail).toContain('上限')
  })

  it('空ページと次ページトークンを返し続ける応答でも回り続けずに失敗する', async () => {
    // 件数だけを見ていると、空ページを返し続ける応答で全体の締め切りまで回り続ける
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [], nextPageToken: 'loop' }, loop: { nextPageToken: 'loop' } },
    })

    const result = await gatewayWith(fetchImpl, { maxMessages: 100 }).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: false })
    expect(result.failure.detail).toContain('ページ数')
  })
})

describe('GmailMailFetchGateway（トークン失効の判別）', () => {
  it('refresh token が失効していれば oauth_revocation_detected を返す', async () => {
    const { fetchImpl } = stubGmail({
      token: new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('oauth_revocation_detected')
  })

  it('保管トークンに refresh token が無ければ失効として扱う（再認可でしか回復しない）', async () => {
    const { fetchImpl } = stubGmail({})

    const result = await gatewayWith(fetchImpl, {
      resolveTokenJson: () => Promise.resolve(JSON.stringify({ access_token: 'only-access' })),
    }).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('oauth_revocation_detected')
  })

  it.each([
    ['NotFoundError', new NotFoundError('ParameterStoreValue', 'path')],
    [
      'SDK の ParameterNotFound',
      Object.assign(new Error('not found'), { name: 'ParameterNotFound' }),
    ],
  ])('トークンが保管されていなければ失効として扱う（%s）', async (_name, error) => {
    const { fetchImpl } = stubGmail({})

    const result = await gatewayWith(fetchImpl, {
      resolveTokenJson: () => Promise.reject(error),
    }).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('oauth_revocation_detected')
  })

  it('Gmail API の 401 は失効として扱う', async () => {
    const { fetchImpl } = stubGmail({ pages: { '': new Response('', { status: 401 }) } })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('oauth_revocation_detected')
  })

  it('スコープ不足の 403 は失効、レート制限の 403 はその他の失敗（やり直しで直る）として区別する', async () => {
    const scopeStub = stubGmail({
      pages: {
        '': new Response(
          JSON.stringify({ error: { errors: [{ reason: 'insufficientPermissions' }] } }),
          {
            status: 403,
          },
        ),
      },
    })
    const scope = await gatewayWith(scopeStub.fetchImpl).fetchMails(REQUEST)
    expect(scope.ok).toBe(false)
    if (scope.ok) return
    expect(scope.failure.kind).toBe('oauth_revocation_detected')

    const rateStub = stubGmail({
      pages: {
        '': new Response(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }), {
          status: 403,
        }),
      },
    })
    const rateLimit = await gatewayWith(rateStub.fetchImpl).fetchMails(REQUEST)
    expect(rateLimit.ok).toBe(false)
    if (rateLimit.ok) return
    expect(rateLimit.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: true })
  })

  it('トークン更新が 200 でもトークンを含まない応答は失効に倒さない（設定・実装の問題）', async () => {
    const { fetchImpl } = stubGmail({ token: jsonResponse({ token_type: 'Bearer' }) })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: false })
  })
})

describe('GmailMailFetchGateway（その他の取得失敗）', () => {
  it.each([
    ['5xx', 503, true],
    ['400', 400, false],
  ])('Gmail API の %s を再試行可否つきで翻訳する', async (_name, status, retryable) => {
    const { fetchImpl } = stubGmail({ pages: { '': new Response('', { status }) } })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable })
  })

  it('通信断は失効と取り違えず、やり直しで直りうる失敗として返す', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith(TOKEN_ENDPOINT))
        return jsonResponse({ access_token: ACCESS_TOKEN })
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: true })
  })

  it('本文取得の途中で失敗したら、取得できた分を成功として返さない', async () => {
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }, { id: 'msg-bank-1' }] } },
      messages: {
        'msg-card-1': cardUsageMessage(),
        'msg-bank-1': new Response('', { status: 503 }),
      },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    // 部分成功を返すと、取りこぼしたメールを含む結果が「取得完了」として記録される
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: true })
    expect(result.failure.detail).toContain('msg-bank-1')
  })

  it('取得直前に消えたメール（404）はやり直す価値のある失敗として返す', async () => {
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }] } },
      messages: { 'msg-card-1': new Response('', { status: 404 }) },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: true })
  })

  it('受信日時を欠いたメール応答は既定値で埋めず失敗として返す', async () => {
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }] } },
      messages: {
        'msg-card-1': {
          id: 'msg-card-1',
          payload: { mimeType: 'text/plain', headers: [], body: { data: '' } },
        },
      },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    // 1970-01-01 の取引候補が下流へ流れるより、取得を失敗にして気づけるほうがよい
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: false })
  })

  it('失敗の詳細に応答ボディ・保管先パス・メールアドレスを載せない（そのままログに出るため）', async () => {
    // 外部データを実際に読む唯一の経路（403 の理由コード判定）に秘匿情報を混ぜて確かめる
    const leaky = JSON.stringify({
      error: { message: `${TOKEN_REF} statement@vpass.ne.jp ご利用金額：2,420円` },
    })
    const cases = [
      stubGmail({ pages: { '': new Response(leaky, { status: 403 }) } }),
      stubGmail({ pages: { '': new Response(leaky, { status: 401 }) } }),
      stubGmail({ pages: { '': new Response(leaky, { status: 500 }) } }),
      stubGmail({ token: new Response(leaky, { status: 400 }) }),
    ]

    for (const stub of cases) {
      const result = await gatewayWith(stub.fetchImpl).fetchMails(REQUEST)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.failure.detail).not.toContain(TOKEN_REF)
      expect(result.failure.detail).not.toContain('@')
      expect(result.failure.detail).not.toContain('2,420')
    }
  })
})

/**
 * #478 段階1: 送信認証（DKIM / SPF / DMARC）の判定を記録に残す。
 * 確かめたいのは「記録が残ること」と「記録を根拠に 1 通も弾いていないこと」の 2 点。
 * この段階で弾くと、正規の通知が思わぬ理由で不合格だったときに利用が丸ごと取り込まれなくなる。
 */
describe('GmailMailFetchGateway（送信認証の判定の記録）', () => {
  const withAuthHeader = (message: unknown, values: readonly string[]): unknown => {
    const typed = message as { payload: { headers: { name: string; value: string }[] } }
    return {
      ...(message as object),
      payload: {
        ...typed.payload,
        headers: [
          ...values.map(value => ({ name: 'Authentication-Results', value })),
          ...typed.payload.headers,
        ],
      },
    }
  }

  it('取り込んだメールごとに、送信元と方式ごとの判定を記録する', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }, { id: 'msg-amazon-1' }] } },
      messages: {
        'msg-card-1': withAuthHeader(cardUsageMessage(), [
          'mx.google.com; dkim=pass header.i=@vpass.ne.jp; spf=pass; dmarc=pass',
        ]),
        'msg-amazon-1': withAuthHeader(amazonMessage(), ['mx.google.com; dkim=pass; spf=none']),
      },
    })

    await gatewayWith(fetchImpl).fetchMails(REQUEST)

    const records = info.mock.calls.filter(([, record]) => typeof record === 'object')
    expect(records).toHaveLength(2)
    expect(records[0]?.[1]).toEqual({
      gmailMessageId: 'msg-card-1',
      sender: 'smbc_card',
      authServId: 'mx.google.com',
      dkim: 'pass',
      spf: 'pass',
      dmarc: 'pass',
    })
    // 送信元ごとに集計できるよう、Amazon 側にも送信元の目印が付く
    expect(records[1]?.[1]).toMatchObject({ sender: 'amazon', spf: 'none', dmarc: 'absent' })
    info.mockRestore()
  })

  it('送信認証に不合格のメールも取り込む（この段階では弾かない）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }] } },
      messages: {
        'msg-card-1': withAuthHeader(cardUsageMessage(), [
          'mx.google.com; dkim=fail; spf=fail; dmarc=fail',
        ]),
      },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails).toHaveLength(1)
    // 記録に埋もれないよう、不合格は警告として出す
    expect(
      warn.mock.calls.some(([, record]) => (record as { dkim?: string })?.dkim === 'fail'),
    ).toBe(true)
    vi.restoreAllMocks()
  })

  it('ヘッダが無いメールも取り込み、判定なしとして記録する', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }] } },
      messages: { 'msg-card-1': cardUsageMessage() },
    })

    const result = await gatewayWith(fetchImpl).fetchMails(REQUEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.smbcMails).toHaveLength(1)
    expect(info.mock.calls[0]?.[1]).toMatchObject({
      dkim: 'absent',
      spf: 'absent',
      dmarc: 'absent',
    })
    info.mockRestore()
  })

  it('記録に件名・本文・差出人アドレスを載せない（そのままログに出るため）', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { fetchImpl } = stubGmail({
      pages: { '': { messages: [{ id: 'msg-card-1' }] } },
      messages: {
        'msg-card-1': withAuthHeader(cardUsageMessage(), [
          'mx.google.com; spf=pass (google.com: domain of statement@vpass.ne.jp designates 203.0.113.1 as permitted sender) smtp.mailfrom=statement@vpass.ne.jp',
        ]),
      },
    })

    await gatewayWith(fetchImpl).fetchMails(REQUEST)

    const logged = JSON.stringify(info.mock.calls)
    expect(logged).not.toContain('@')
    expect(logged).not.toContain('2,420')
    expect(logged).not.toContain('ご利用のお知らせ')
    info.mockRestore()
  })
})

describe('createUnconfiguredGmailMailFetchGateway', () => {
  it('未構成でも例外を投げず、やり直しでは直らない失敗として返す', async () => {
    const result = await createUnconfiguredGmailMailFetchGateway().fetchMails(REQUEST)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ kind: 'other_fetch_failure', retryable: false })
  })
})
