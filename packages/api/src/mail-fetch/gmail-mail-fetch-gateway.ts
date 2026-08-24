/**
 * GmailMailFetchGateway の Gmail API 実装（ACL 翻訳層、#412）
 * @see docs/domain/08a-ul-取引取込.md §2「Gmail からメールを取得する」
 *
 * 取込対象期間の SMBC 通知メール / Amazon 注文確認メールを、パース前の外部表現のまま取得する。
 * 本文のパース（#415）・重複除外・取引候補の生成（#414）はこの層の責務ではない。
 *
 * 経路:
 *  1. Parameter Store に保管された OAuth トークン JSON（`GoogleGmailOAuthGateway` が保管したもの）
 *     を復号取得し、refresh token でアクセストークンを更新する。アクセストークンの寿命は 1 時間で、
 *     日次バッチの間隔より短いため、保管済みの access_token は当てにしない
 *  2. `GET /messages` で対象送信元 × 期間を検索（Gmail の検索演算子でサーバー側に絞らせる）
 *  3. 各メッセージを `GET /messages/{id}?format=full` で取得し、MIME から本文を取り出す
 *
 * 実メールの形（#415 の .eml 調査）に合わせた注意点:
 *  - 件名・送信元ヘッダは RFC 2047 の encoded-word（`=?ISO-2022-JP?B?...?=`）で届くため、
 *    突き合わせる前にデコードする
 *  - 本文は `multipart/alternative`（カード利用通知）または `multipart/signed`（銀行通知の S/MIME）
 *    の入れ子にあるため、パートを再帰で辿って text/plain を選ぶ
 *  - charset は `iso-2022-jp`。`TextDecoder` に charset を渡してデコードする（UTF-8 前提で読むと
 *    本文がエスケープシーケンスのまま残り、パースが「文字化け」として全滅する）
 *
 * 失敗の翻訳（ドメインの `MailFetchFailure`）:
 *  - refresh token での更新が `invalid_grant` / 保管トークンに refresh token が無い /
 *    Gmail API が 401・スコープ不足の 403 → `oauth_revocation_detected`
 *    （再認可の導線 #392 の起点。ここを取り違えると、通信断のたびにユーザーへ再認可を求める）
 *  - それ以外（通信断・タイムアウト・5xx・429・設定不備・応答構造の不正）→ `other_fetch_failure`
 *    やり直しで直りうるものだけ `retryable: true`
 *
 * `detail` には応答ボディ・メール本文・Parameter Store のパス・メールアドレスを載せない
 * （ログに出る前提で、金額・氏名・保管先パス（ユーザーID を含む）を漏らさないため）。
 *
 * 送信元は実アドレスの一致で判定する。差出人アドレス自体は詐称できるため、これだけでは
 * 三井住友カードを装ったメールを弾けない。#478 の決定に従い、まず受信サーバが付けた送信認証
 * （DKIM / SPF / DMARC）の判定を**取り込んだメールごとに記録に残す**段階から始める。
 * **この段階では判定を根拠に 1 通も弾かない**（正規の通知が不合格になる余地を確かめる前に弾くと、
 * その月の利用が丸ごと取り込まれない）。記録で正規の通知が必ず合格することを確かめたうえで、
 * 弾く側へ切り替える（段階3、別 Issue）。
 */
import type {
  AmazonOrderConfirmationMailBody,
  GmailMailFetchGateway,
  MailFetchFailure,
  MailFetchRequest,
  MailFetchResult,
  MailKindHint,
  ParameterStorePath,
  SmbcNotificationMailBody,
} from '@warimaru/domain'
import { GmailMessageIdSchema, NotFoundError } from '@warimaru/domain'
import { z } from 'zod'
import { withTimeout } from '../with-timeout.js'
import {
  isFullyAuthenticated,
  parseAuthenticationResults,
  type MailAuthenticationResults,
} from './authentication-results.js'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** 取得対象の送信元（#415 の実メール調査で確定）。カード利用通知 */
const SMBC_CARD_SENDER = 'statement@vpass.ne.jp'
/** 銀行の各種通知（振込入金・口座引き落としの事前お知らせ）は同じ送信元から届く */
const SMBC_BANK_SENDER = 'smbc_service@dn.smbc.co.jp'
/** Amazon 注文確認メールは送信元アドレスが用途ごとに分かれるためドメインで絞る */
const AMAZON_SENDER_DOMAIN = 'amazon.co.jp'

/** 外部呼び出し 1 回ごとの上限。バッチ実行なので Webhook 応答パスより長く取る */
const DEFAULT_TIMEOUT_MS = 15_000
/** 取得全体の締め切り（トークン更新 + 検索 + 件数分の本文取得の合計） */
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000
/**
 * 1 回の取得で扱うメール件数の上限。過去 5 日の再走査（OQ-31）で現実に届く件数から十分離した
 * 値にしてある。超えたときは黙って打ち切らず失敗を返す（打ち切ると取りこぼしを「完了」として
 * 記録してしまい、取引が永久に取り込まれない）
 */
const DEFAULT_MAX_MESSAGES = 500
/** Gmail の検索 1 ページあたりの件数 */
const PAGE_SIZE = 100
/**
 * 1 通あたりに読み込む本文の上限バイト数。通知メールは数 KB で、これを大きく超えるのは
 * 想定外（添付を抱えたメールが対象送信元から届いた等）。上限超過は本文を空として扱い、
 * パース側の失敗として記録させる（メールごと捨てると Gmail message ID が記録に残らない）
 */
const MAX_BODY_BYTES = 256 * 1024

/**
 * 件名による種別ヒント（#415 の実メール調査）。判別できない場合は unknown でパース側に委ねる。
 * 件名文字列は外部表現なので ACL（この層）が持つ。パース（#415）は本文構造で種別を確定させる
 * ため、同じ件名定数をドメイン側へ複製しない
 */
const SUBJECT_HINTS: readonly { readonly subject: string; readonly hint: MailKindHint }[] = [
  { subject: 'ご利用のお知らせ【三井住友カード】', hint: 'card_usage' },
  { subject: '【三井住友銀行】口座引き落としの事前お知らせ', hint: 'card_settlement_confirmed' },
  { subject: '【三井住友銀行】振込入金のお知らせ', hint: 'bank_deposit' },
]

export interface GmailMailFetchGatewayConfig {
  /** Google OAuth クライアント（アクセストークンの更新に使う） */
  clientId: string
  clientSecret: string
  /** Parameter Store（KMS）からの OAuth トークン JSON の復号取得 */
  resolveTokenJson: (path: ParameterStorePath) => Promise<string>
  fetchImpl?: typeof fetch
  /** 外部呼び出し 1 回ごとの上限 */
  timeoutMs?: number
  /** 取得全体の締め切り */
  totalTimeoutMs?: number
  /** 扱うメール件数の上限（超えたら失敗を返す） */
  maxMessages?: number
}

/**
 * 送信元の目印（#478 段階1 の記録を送信元ごとに集計するためのラベル）。
 * ログに残す値なので、アドレスそのものではなく固定のラベルにする。
 * 対応: `smbc_card` = `SMBC_CARD_SENDER` / `smbc_bank` = `SMBC_BANK_SENDER` /
 * `amazon` = `AMAZON_SENDER_DOMAIN`（送信元を増やすときはこのラベルも足す）
 */
type MailSender = 'smbc_card' | 'smbc_bank' | 'amazon'

/** 取り込んだメール 1 通ぶんの送信認証の記録（#478 段階1） */
interface MailAuthenticationObservation {
  gmailMessageId: string
  sender: MailSender
  results: MailAuthenticationResults
}

interface GmailHeader {
  name?: string
  value?: string
}

interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}

/**
 * 依存しているフィールドだけを検証する。応答が想定の形でないときに既定値で埋めると、
 * 「受信日時 1970-01-01」「ID 空」の候補が黙って下流へ流れるため、失敗として返す。
 * MIME ツリー（payload）は形が開かれているので構造検証の対象にせず、本文を取り出せない
 * ケースは本文空として扱う。
 */
const GmailMessageResponseSchema = z.object({
  id: z.string().min(1),
  /** epoch ミリ秒の文字列（Gmail API の仕様） */
  internalDate: z.string().regex(/^\d+$/),
  payload: z.unknown().optional(),
})
type GmailMessageResponse = z.infer<typeof GmailMessageResponseSchema>

const GmailMessageListResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).optional(),
  nextPageToken: z.string().optional(),
})

/** Gmail の検索は `after` / `before` に epoch 秒を受け付ける（日付指定より境界が正確） */
function epochSeconds(at: Date): number {
  return Math.floor(at.getTime() / 1000)
}

/**
 * 検索条件を組み立てる。`includeSpamTrash` は付けないため、**迷惑メール・ゴミ箱のメールは
 * 対象外**になる（Gmail API の既定）。送信元を騙る偽の通知を取り込まない側に倒した既定で、
 * 正規の通知が迷惑メール判定されると静かに取りこぼすが、#478 の決定により**当面この既定のまま
 * にする**（なりすまし対策が効くまでは、取りこぼしより取り違えを避ける側に倒す。取りこぼした
 * 月は CSV 取込で補う）。含める判断は送信認証の記録が溜まってから改めて行う。
 */
function buildSearchQuery(from: Date, to: Date): string {
  const senders = [
    `from:${SMBC_CARD_SENDER}`,
    `from:${SMBC_BANK_SENDER}`,
    `from:${AMAZON_SENDER_DOMAIN}`,
  ].join(' OR ')
  return `(${senders}) after:${epochSeconds(from)} before:${epochSeconds(to)}`
}

function headerValue(part: GmailPart | undefined, name: string): string {
  const lower = name.toLowerCase()
  const found = part?.headers?.find(h => (h.name ?? '').toLowerCase() === lower)
  return found?.value ?? ''
}

/**
 * 同名ヘッダの値を**メールに現れる順**（上から順）で集める。`Authentication-Results` は
 * 受信サーバが受信時に先頭へ足すため、順序が意味を持つ（下位は送信者が埋め込める）。
 */
function headerValues(part: GmailPart | undefined, name: string): string[] {
  const lower = name.toLowerCase()
  return (part?.headers ?? [])
    .filter(h => (h.name ?? '').toLowerCase() === lower)
    .map(h => h.value ?? '')
}

function decodeBytes(bytes: Uint8Array, charset: string, context?: string): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    // 未知の charset ラベル。UTF-8 として読み、パース側の「文字化け」判定に委ねる。
    // 黙って倒すと「元から壊れた本文」と区別できなくなるため、どのメールで起きたかを残す
    if (context !== undefined) {
      console.warn('Gmail メール取得: 未知の charset のため UTF-8 として読んだ', {
        charset,
        gmailMessageId: context,
      })
    }
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/**
 * RFC 2047 の encoded-word をデコードする。日本語の件名・送信元表示名は
 * `=?ISO-2022-JP?B?...?=` の形で届き、そのままでは件名の突き合わせができない。
 * 隣接する encoded-word の間の空白は仕様どおり落とす（分割された 1 語が空白で割れないように）。
 */
function decodeEncodedWords(value: string): string {
  if (!value.includes('=?')) return value
  const pattern = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g
  let result = ''
  let lastIndex = 0
  let previousWasEncoded = false
  for (const match of value.matchAll(pattern)) {
    const start = match.index
    const between = value.slice(lastIndex, start)
    // encoded-word が連続する場合、その間の空白のみの区切りは表示に含めない（RFC 2047 §6.2）
    if (!(previousWasEncoded && between.trim() === '')) result += between
    const [, charset = 'utf-8', encoding = 'B', text = ''] = match
    const bytes =
      encoding.toUpperCase() === 'B'
        ? new Uint8Array(Buffer.from(text, 'base64'))
        : new Uint8Array(
            Buffer.from(
              text
                .replace(/_/g, ' ')
                .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
                  String.fromCharCode(parseInt(hex, 16)),
                ),
              'binary',
            ),
          )
    result += decodeBytes(bytes, charset)
    lastIndex = start + match[0].length
    previousWasEncoded = true
  }
  return result + value.slice(lastIndex)
}

/**
 * `三井住友カード <statement@vpass.ne.jp>` からアドレス部分だけを取り出す。
 *
 * **表示名に対象アドレスを埋め込んだ From で送信元判定をすり抜けられないようにする**のが要点。
 * 表示名は差出人が自由に決められるので、`"attacker@example.com <statement@vpass.ne.jp>"
 * <evil@example.com>` のような From を素朴に読むと、第三者のメールを SMBC の通知として
 * 取り込み、家計簿に偽の取引・金額が混入する。
 *
 * 実アドレス（RFC 5322 の addr-spec）を得るために、引用符付き表示名とコメントを先に落とす。
 * それでも `<...>` が複数残る From は正しい形ではないので、判定できないものとして空を返す
 * （呼出し側が対象外として捨てる = 取り込まない側に倒す）。
 */
function addressOf(fromHeader: string): string {
  const withoutQuoted = fromHeader.replace(/"(?:[^"\\]|\\.)*"/g, '')
  const withoutComments = withoutQuoted.replace(/\([^()]*\)/g, '')
  const angled = [...withoutComments.matchAll(/<([^<>]*)>/g)]
  if (angled.length > 1) return ''
  return (angled[0]?.[1] ?? withoutComments).trim().toLowerCase()
}

function charsetOf(part: GmailPart): string {
  const contentType = headerValue(part, 'Content-Type')
  const matched = /charset="?([^";\s]+)"?/i.exec(contentType)
  return matched?.[1] ?? 'utf-8'
}

/**
 * MIME を再帰で辿って本文を取り出す。`multipart/alternative`（カード利用通知）と
 * `multipart/signed`（銀行通知の S/MIME）の入れ子があるため、深さを問わず text/plain を探し、
 * 無ければ text/html で代替する。添付（filename 付き）は本文ではないので見ない。
 */
function extractBody(payload: GmailPart | undefined, gmailMessageId: string): string {
  if (payload === undefined) return ''
  const plain = findPart(payload, 'text/plain')
  const part = plain ?? findPart(payload, 'text/html')
  const data = part?.body?.data
  if (part === undefined || data === undefined) return ''
  const bytes = new Uint8Array(Buffer.from(data, 'base64url'))
  if (bytes.byteLength > MAX_BODY_BYTES) {
    // 通知メールとしては明らかに大きい。丸ごと抱えるとバッチのメモリが跳ねるため本文は載せず、
    // メール自体は（Gmail message ID を残すため）捨てない
    console.warn('Gmail メール取得: 本文が上限を超えたため本文なしとして扱った', {
      gmailMessageId,
      bytes: bytes.byteLength,
    })
    return ''
  }
  return decodeBytes(bytes, charsetOf(part), gmailMessageId)
}

function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  if ((part.mimeType ?? '').toLowerCase() === mimeType && (part.filename ?? '') === '') {
    return part.body?.data === undefined ? undefined : part
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found !== undefined) return found
  }
  return undefined
}

function hintOf(subject: string): MailKindHint {
  return SUBJECT_HINTS.find(candidate => subject.includes(candidate.subject))?.hint ?? 'unknown'
}

function isAmazonSender(address: string): boolean {
  const at = address.lastIndexOf('@')
  // `@` を含まない値はアドレスとして成立していない。ドメインだけの文字列
  // （`From: amazon.co.jp`）を Amazon と認めない
  if (at < 0) return false
  const domain = address.slice(at + 1)
  return domain === AMAZON_SENDER_DOMAIN || domain.endsWith(`.${AMAZON_SENDER_DOMAIN}`)
}

function isSmbcSender(address: string): boolean {
  return address === SMBC_CARD_SENDER || address === SMBC_BANK_SENDER
}

function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
}

function otherFailure(detail: string, retryable: boolean, at: Date): MailFetchFailure {
  return { kind: 'other_fetch_failure', detail, detectedAt: at, retryable }
}

function revoked(detail: string, at: Date): MailFetchFailure {
  return { kind: 'oauth_revocation_detected', detail, detectedAt: at }
}

/** 呼び出しを中断して失敗を返すための内部例外（外へは漏らさない） */
class MailFetchAbort extends Error {
  constructor(readonly failure: MailFetchFailure) {
    super(failure.detail)
    this.name = 'MailFetchAbort'
  }
}

export function createGmailMailFetchGateway(
  config: GmailMailFetchGatewayConfig,
): GmailMailFetchGateway {
  const fetchImpl = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const totalTimeoutMs = config.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS
  const maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES

  return {
    async fetchMails(request: MailFetchRequest): Promise<MailFetchResult> {
      const now = (): Date => new Date()
      const deadline = Date.now() + totalTimeoutMs
      const remaining = (): number => deadline - Date.now()
      const callTimeout = (): number => Math.min(timeoutMs, Math.max(remaining(), 1))

      /**
       * Gmail API を叩き、失敗を MailFetchFailure に翻訳して中断する。
       * `target` は失敗がどの呼び出しで起きたかを残すための目印（検索か、どのメールか）。
       * Gmail message ID は重複除外のため DB にも保持する識別子で、PII ではない。
       */
      const callGmail = async (
        url: string,
        accessToken: string,
        target: string,
      ): Promise<unknown> => {
        if (remaining() <= 0) {
          throw new MailFetchAbort(otherFailure('メール取得が全体の制限時間を超えた', true, now()))
        }
        let response: Response
        try {
          response = await fetchImpl(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(callTimeout()),
          })
        } catch (e) {
          throw new MailFetchAbort(
            otherFailure(
              isTimeoutError(e)
                ? `Gmail API がタイムアウトした（${target}）`
                : `Gmail API の呼び出しに失敗した（${target}: ${e instanceof Error ? e.name : 'unknown'}）`,
              true,
              now(),
            ),
          )
        }
        if (!response.ok) {
          throw new MailFetchAbort(await translateGmailError(response, target, now()))
        }
        try {
          return (await response.json()) as unknown
        } catch (e) {
          // 応答の受信は本体の読み出し中も中断されうる。回線の遅延を「やり直しても直らない」に
          // 倒すと、一時障害が設定不備と同じ扱いで記録される
          throw new MailFetchAbort(
            isTimeoutError(e)
              ? otherFailure(`Gmail API の応答の受信が中断された（${target}）`, true, now())
              : otherFailure(`Gmail API の応答を解釈できなかった（${target}）`, false, now()),
          )
        }
      }

      try {
        const accessToken = await refreshAccessToken({
          config,
          fetchImpl,
          tokenStoreRef: request.tokenStoreRef,
          timeout: callTimeout,
          now,
        })

        const messageIds = await listMessageIds({
          callGmail,
          accessToken,
          query: buildSearchQuery(request.period.from, request.period.to),
          maxMessages,
          now,
        })

        const smbcMails: SmbcNotificationMailBody[] = []
        const amazonMails: AmazonOrderConfirmationMailBody[] = []
        const skipped: string[] = []
        const observations: MailAuthenticationObservation[] = []
        for (const id of messageIds) {
          const raw = await callGmail(
            `${GMAIL_API_BASE}/messages/${encodeURIComponent(id)}?format=full`,
            accessToken,
            `message:${id}`,
          )
          const parsed = GmailMessageResponseSchema.safeParse(raw)
          if (!parsed.success) {
            // 受信日時や ID を既定値で埋めて先へ進めない。1970-01-01 の取引候補や、
            // Gmail message ID の無い候補が下流に流れると重複除外も追跡もできなくなる
            throw new MailFetchAbort(
              otherFailure(
                `Gmail API のメール応答が想定の構造と異なる（message:${id}）`,
                false,
                now(),
              ),
            )
          }
          const classified = toMailBody(parsed.data)
          if (classified === undefined) {
            skipped.push(id)
            continue
          }
          // 送信認証の判定は取り込んだメールぶんだけ記録する（対象送信元でないものは
          // 取り込まないので、記録しても段階2 の「正規の通知が合格しているか」の確認には使えない）
          observations.push({
            gmailMessageId: classified.mail.gmailMessageId,
            sender: classified.sender,
            results: classified.authentication,
          })
          if (classified.kind === 'smbc') smbcMails.push(classified.mail)
          else amazonMails.push(classified.mail)
        }

        recordAuthenticationResults(observations)

        // 検索でヒットしたのに対象送信元と判定されなかったメールは捨てている。送信元アドレスの
        // 形が変わったときに「取得完了」の陰で毎日取りこぼし続けるのを避けるため、件数と ID を残す
        // （件名は Amazon だと商品名が入るため出さない）
        if (skipped.length > 0) {
          console.warn(
            `Gmail メール取得: 対象送信元と判定されなかったメールを ${skipped.length} 件除外した`,
            { gmailMessageIds: skipped },
          )
        }

        return { ok: true, smbcMails, amazonMails }
      } catch (e) {
        if (e instanceof MailFetchAbort) return { ok: false, failure: e.failure }
        // 想定外の例外も呼出し側（日次バッチ）を落とさず失敗として返す。detail に例外の中身は載せない
        return {
          ok: false,
          failure: otherFailure(
            `メール取得に失敗した（${e instanceof Error ? e.name : 'unknown'}）`,
            false,
            now(),
          ),
        }
      }
    },
  }
}

/**
 * Gmail API のエラー応答を失効 / その他へ翻訳する。
 * 401 は資格情報が通らない状態、403 はスコープ不足のときだけ失効に倒す（403 は
 * レート制限でも返るため、本文の理由コードを見て取り違えを避ける）。
 */
async function translateGmailError(
  response: Response,
  target: string,
  at: Date,
): Promise<MailFetchFailure> {
  if (response.status === 401) {
    return revoked('Gmail API が認可を拒否した（401）', at)
  }
  if (response.status === 403) {
    // 応答ボディは detail に載せず、理由コードの判定にのみ使う
    const body = await response.text().catch(() => '')
    const scopeInsufficient =
      body.includes('insufficientPermissions') || body.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')
    return scopeInsufficient
      ? revoked('Gmail API のスコープが不足している（403）', at)
      : otherFailure('Gmail API が 403 を返した（レート制限・権限設定を確認する）', true, at)
  }
  // 検索から本文取得までの間に利用者がメールを削除・ゴミ箱へ移すと 404 になる。翌日の再走査では
  // そのメールが検索に出ないので自然に回復する = やり直す価値のある失敗
  if (response.status === 404) {
    return otherFailure(`Gmail API が 404 を返した（取得前にメールが消えた: ${target}）`, true, at)
  }
  const retryable = response.status === 429 || response.status >= 500
  return otherFailure(`Gmail API が ${response.status} を返した（${target}）`, retryable, at)
}

/**
 * 保管済みの OAuth トークン JSON から refresh token を取り出し、アクセストークンを更新する。
 * refresh token が無い / `invalid_grant` は再認可でしか回復しないため失効として扱う。
 */
async function refreshAccessToken(args: {
  config: GmailMailFetchGatewayConfig
  fetchImpl: typeof fetch
  tokenStoreRef: ParameterStorePath
  timeout: () => number
  now: () => Date
}): Promise<string> {
  const { config, fetchImpl, tokenStoreRef, timeout, now } = args

  let tokenJson: string
  try {
    tokenJson = await withTimeout(config.resolveTokenJson(tokenStoreRef), timeout())
  } catch (e) {
    // 保管されたトークンが無い = そもそも認可されていない（または連携を解除された）。
    // やり直しても直らず、再認可でしか回復しない。Parameter Store の SDK は未保管を
    // ParameterNotFound で返すため、翻訳漏れに備えて名前でも拾う
    if (e instanceof NotFoundError || (e instanceof Error && e.name === 'ParameterNotFound')) {
      throw new MailFetchAbort(revoked('Gmail OAuth トークンが保管されていない', now()))
    }
    // 通信断・タイムアウトはやり直しで直りうるが、権限不足や未構成は直らない。
    // 一律 retryable にすると、設定不備が「待てば直る」として記録され誰も追わなくなる
    const transient = isTimeoutError(e) || e instanceof TypeError
    throw new MailFetchAbort(
      otherFailure(
        isTimeoutError(e)
          ? 'Gmail OAuth トークンの取得がタイムアウトした'
          : `Gmail OAuth トークンの取得に失敗した（${e instanceof Error ? e.name : 'unknown'}）`,
        transient,
        now(),
      ),
    )
  }

  let refreshToken: unknown
  try {
    refreshToken = (JSON.parse(tokenJson) as { refresh_token?: unknown }).refresh_token
  } catch {
    throw new MailFetchAbort(
      otherFailure('保管された Gmail OAuth トークンを解釈できなかった', false, now()),
    )
  }
  if (typeof refreshToken !== 'string' || refreshToken === '') {
    // access_token だけでは 1 時間で使えなくなる。回復には再認可が要る
    throw new MailFetchAbort(
      revoked('保管された Gmail OAuth トークンに refresh token が含まれていない', now()),
    )
  }

  let response: Response
  try {
    response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(timeout()),
    })
  } catch (e) {
    throw new MailFetchAbort(
      otherFailure(
        isTimeoutError(e)
          ? 'アクセストークンの更新がタイムアウトした'
          : `アクセストークンの更新に失敗した（${e instanceof Error ? e.name : 'unknown'}）`,
        true,
        now(),
      ),
    )
  }

  if (!response.ok) {
    // Google は失効・取り消し・ユーザーによる連携解除をまとめて 400 invalid_grant で返す
    const body = await response.text().catch(() => '')
    if (response.status === 400 && body.includes('invalid_grant')) {
      throw new MailFetchAbort(revoked('refresh token が失効している（invalid_grant）', now()))
    }
    const retryable = response.status === 429 || response.status >= 500
    throw new MailFetchAbort(
      otherFailure(`アクセストークンの更新が ${response.status} で失敗した`, retryable, now()),
    )
  }

  const accessToken = ((await response.json().catch(() => ({}))) as { access_token?: unknown })
    .access_token
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new MailFetchAbort(
      otherFailure('アクセストークンの更新の応答にトークンが含まれていない', false, now()),
    )
  }
  return accessToken
}

/** 検索結果を全ページ辿って message ID を集める。上限を超えたら黙って切らずに失敗させる */
async function listMessageIds(args: {
  callGmail: (url: string, accessToken: string, target: string) => Promise<unknown>
  accessToken: string
  query: string
  maxMessages: number
  now: () => Date
}): Promise<string[]> {
  const { callGmail, accessToken, query, maxMessages, now } = args
  const ids: string[] = []
  let pageToken: string | undefined
  // ページ数の上限。件数だけを見ていると、空ページと nextPageToken を返し続ける応答で
  // 全体の締め切りまで回り続ける
  const maxPages = Math.ceil(maxMessages / PAGE_SIZE) + 1
  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      throw new MailFetchAbort(
        otherFailure('Gmail の検索結果のページ数が上限を超えた', false, now()),
      )
    }
    const url =
      `${GMAIL_API_BASE}/messages?maxResults=${PAGE_SIZE}&q=${encodeURIComponent(query)}` +
      (pageToken === undefined ? '' : `&pageToken=${encodeURIComponent(pageToken)}`)
    const parsed = GmailMessageListResponseSchema.safeParse(
      await callGmail(url, accessToken, 'list'),
    )
    if (!parsed.success) {
      throw new MailFetchAbort(
        otherFailure('Gmail API の検索応答が想定の構造と異なる', false, now()),
      )
    }
    for (const message of parsed.data.messages ?? []) ids.push(message.id)
    if (ids.length > maxMessages) {
      throw new MailFetchAbort(
        otherFailure(
          `取得対象が上限（${maxMessages} 件）を超えた（取込対象期間を短くする）`,
          false,
          now(),
        ),
      )
    }
    pageToken = parsed.data.nextPageToken
    if (pageToken === undefined || pageToken === '') return ids
  }
}

/**
 * Gmail のメッセージを外部表現へ翻訳する。対象送信元でないものは undefined を返して捨てる
 * （検索で絞ってはいるが、`from:` は表示名にも当たるため念のため取得側でも確かめる）。
 *
 * 本文を取り出せないメール（text パートが無い等）は捨てずに本文空で載せる。捨てると Gmail
 * message ID ごと消えて「取り込めなかったこと」が記録に残らないため、パース側の失敗
 * （`MailParseFailed`）として扱わせる。
 */
function toMailBody(message: GmailMessageResponse):
  | {
      kind: 'smbc'
      sender: MailSender
      authentication: MailAuthenticationResults
      mail: SmbcNotificationMailBody
    }
  | {
      kind: 'amazon'
      sender: MailSender
      authentication: MailAuthenticationResults
      mail: AmazonOrderConfirmationMailBody
    }
  | undefined {
  const id = message.id
  // payload の形は開かれているのでここで型を絞る（欠落・想定外は本文空・ヘッダ空として扱う）
  const payload = message.payload as GmailPart | undefined
  const address = addressOf(decodeEncodedWords(headerValue(payload, 'From')))
  const subject = decodeEncodedWords(headerValue(payload, 'Subject'))
  const receivedAt = new Date(Number(message.internalDate))
  const body = extractBody(payload, id)
  const gmailMessageId = GmailMessageIdSchema.parse(id)
  const authentication = parseAuthenticationResults(headerValues(payload, 'Authentication-Results'))

  if (isSmbcSender(address)) {
    return {
      kind: 'smbc',
      sender: address === SMBC_CARD_SENDER ? 'smbc_card' : 'smbc_bank',
      authentication,
      mail: { gmailMessageId, receivedAt, subject, body, kindHint: hintOf(subject) },
    }
  }
  if (isAmazonSender(address)) {
    return {
      kind: 'amazon',
      sender: 'amazon',
      authentication,
      mail: { gmailMessageId, receivedAt, subject, body },
    }
  }
  return undefined
}

/**
 * 送信認証の判定を記録する（#478 段階1）。**判定を根拠にメールを弾かない**。
 *
 * 段階2 で「正規の通知が必ず合格しているか」を送信元ごとに数えられるよう、メール 1 通ごとに
 * 送信元の目印と方式ごとの判定を残し、あわせて送信元 × 判定の組み合わせごとの件数を 1 行に
 * まとめて出す。**メール本文・件名・差出人アドレス・利用者を辿れる値は載せない**
 * （Gmail message ID は重複除外のため DB にも持つ識別子で PII ではない）。
 *
 * 記録は取得に付随する処理なので、ここでの失敗が取得そのものを巻き添えにしないよう閉じ込める
 * （取得を失敗にすると、取得済みのメールが丸ごと捨てられ、その期間は CSV 取込でのやり直しになる）。
 */
function recordAuthenticationResults(observations: readonly MailAuthenticationObservation[]): void {
  if (observations.length === 0) return

  try {
    for (const observed of observations) {
      const { gmailMessageId, sender, results } = observed
      const record = {
        gmailMessageId,
        sender,
        authServId: results.authServId,
        dkim: results.dkim,
        spf: results.spf,
        dmarc: results.dmarc,
      }
      // 合格でないものは記録に埋もれさせず、その場で気づけるようにする（この段階では弾かない）
      if (isFullyAuthenticated(results)) {
        console.info('Gmail メール取得: 送信認証の判定結果', record)
      } else {
        console.warn(
          'Gmail メール取得: 送信認証が合格でないメールを取り込んだ（この段階では除外しない）',
          record,
        )
      }
    }

    const counts = new Map<string, number>()
    for (const { sender, results } of observations) {
      const key = `${sender} dkim=${results.dkim} spf=${results.spf} dmarc=${results.dmarc}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    console.info(
      `Gmail メール取得: 送信認証の判定結果（集計）— ${[...counts]
        .map(([key, count]) => `${key} ×${count}`)
        .join(', ')}`,
    )
  } catch (e) {
    console.warn(
      `Gmail メール取得: 送信認証の判定を記録できなかった（${e instanceof Error ? e.name : 'unknown'}）`,
    )
  }
}

/** Gmail が未構成の環境用フォールバック（呼び出し時に失敗として返す。例外は投げない） */
export function createUnconfiguredGmailMailFetchGateway(): GmailMailFetchGateway {
  return {
    fetchMails: () =>
      Promise.resolve({
        ok: false,
        failure: {
          kind: 'other_fetch_failure',
          detail: 'Gmail メール取得が未構成のため取得できない',
          detectedAt: new Date(),
          retryable: false,
        },
      }),
  }
}
