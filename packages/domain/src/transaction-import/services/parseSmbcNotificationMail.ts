/**
 * SMBC 通知メール本文のパース実装（08a §2「SMBC通知メール本文をパースする」/ OQ-1(1)）
 *
 * 三井住友カード・三井住友銀行から届く通知メールの本文から、家計簿に載せる材料
 * （利用日・利用先・金額など）を取り出す。実メール 3 通で確定した本文構造に沿って書いてあり、
 * 抽出規則の一次情報は 08a §2 の「実メールの本文構造（OQ-1(1) 確定）」。
 *
 * 対象は実運用で観測された 3 種のみ:
 *  - `card_usage`（カード利用のお知らせ）
 *  - `bank_deposit`（振込入金のお知らせ）
 *  - `card_settlement_confirmed`（口座引き落としの事前お知らせ）
 * 出金通知・返金通知は実メールが届いていないため、語彙としては残すがパーサは持たない
 * （届くようになったら本文構造を確定してから足す。当てずっぽうの規則で誤った取引候補を
 * 作るより、パース失敗として件数に出るほうが気づける）。
 *
 * ドメインの純粋関数として書く（zod のみ・I/O 依存なし）。例外は投げず、読めなかったものは
 * `parse_failure` として返す — 1 通の異常で日次取込全体を止めないため。
 *
 * 本文はまず NFKC 正規化する。実メールはラベル区切りが全角コロン、カード名が全角英字
 * （`Ｏｌｉｖｅ`）、ラベルと値の間が全角スペース詰め（`内容` の後ろに全角スペースが詰まる）で届くため、正規化前の
 * 生文字列に対して規則を書くと全角・半角の揺れごとに規則が増える（OQ-23）。
 */
import {
  jstDateTimeToUtc,
  utcMidnightOfJstCalendarDate,
} from '../../shared/value-objects/JstCalendar'
import type { GmailMessageId, UserId } from '../../shared/ids'
import { previousMonth, yearMonth } from '../../shared/value-objects/YearMonth'
import { normalizeMerchantName } from '../value-objects/NormalizedMerchantName'
import {
  SmbcMailParseResultSchema,
  type MailParseFailureReason,
  type SmbcMailParseResult,
} from '../value-objects/SmbcMailParseResult'
import type { MailKindHint } from './GmailMailFetchGateway'
import type {
  SmbcNotificationMailParseInput,
  SmbcNotificationMailParser,
} from './SmbcNotificationMailParser'

/** 本文構造を持っている（= パーサがある）メール種別 */
type ParsableKind = 'card_usage' | 'bank_deposit' | 'card_settlement_confirmed'

const PARSABLE_KINDS: readonly ParsableKind[] = [
  'card_usage',
  'bank_deposit',
  'card_settlement_confirmed',
]

/**
 * 種別を選ぶための目印。件名・送信元から付いた種別ヒントは暫定値（08a §1）なので、
 * 最終的な種別は本文構造で決める。3 種の目印は互いに排他で、同じ本文が 2 種に当たることはない。
 *
 * 目印は書き出しの定型文と主要ラベルのどちらでも当たるようにしてある。ラベルだけを目印に
 * すると、そのラベルが欠けたメールが「知らない書式」に落ちてしまい、**必要な値が欠けている**
 * のか **知らない種類のメールが届いた** のかを取り違える（前者は書式変更として追えるが、
 * 後者だと思うと誰も追わない）。
 */
const KIND_MARKERS: Record<ParsableKind, RegExp> = {
  card_usage: /カードご利用内容|◇[ \t]*利用日[ \t]*:/,
  bank_deposit: /振込入金について|^[ \t]*入金日[ \t]*:/m,
  card_settlement_confirmed: /口座引き落としについて|口座引落予定日[ \t]*:/,
}

// ラベルと値の区切りに改行を含む `\s` を使わない。`\s*` にすると値が空のとき（`◇利用先：` の
// 後ろに何も無い）に次の行の値を拾ってしまい、別の項目を加盟店名として取り込む
const SEP = '[ \\t]*:[ \\t]*'

// --- card_usage（カード利用のお知らせ） ---
const CARD_USAGE_DATE = new RegExp(
  `◇[ \\t]*利用日${SEP}(\\d{4})/(\\d{1,2})/(\\d{1,2})[ \\t]+(\\d{1,2}):(\\d{2})`,
)
const CARD_USAGE_MERCHANT = new RegExp(`◇[ \\t]*利用先${SEP}(\\S.*)`)
const CARD_USAGE_AMOUNT = new RegExp(`◇[ \\t]*利用金額${SEP}([\\d,]+)[ \\t]*円`)

// --- bank_deposit（振込入金のお知らせ） ---
// 行頭に固定する: 「引落金額」「入金口座」など、同じ語を含む別ラベルを拾わないため
const DEPOSIT_DATE = new RegExp(
  `^[ \\t]*入金日${SEP}(\\d{4})年[ \\t]*(\\d{1,2})月[ \\t]*(\\d{1,2})日`,
  'm',
)
const DEPOSIT_AMOUNT = new RegExp(`^[ \\t]*金額${SEP}([\\d,]+)[ \\t]*円`, 'm')
const DEPOSIT_CONTENT = new RegExp(`^[ \\t]*内容${SEP}(\\S.*)`, 'm')
/** 振込入金の「内容」に付く接頭辞。この後ろが振込元名 */
const REMITTANCE_PREFIX = /^振込サービス[ \t]*/

// --- card_settlement_confirmed（口座引き落としの事前お知らせ） ---
const SETTLEMENT_DATE = new RegExp(
  `口座引落予定日${SEP}(\\d{4})年[ \\t]*(\\d{1,2})月[ \\t]*(\\d{1,2})日`,
)
/** 明細ブロックの区切り（`◆明細1`。番号は NFKC 正規化で半角になる） */
const DETAIL_SEPARATOR = /^[ \t]*◆[ \t]*明細[ \t]*\d*/m
const DETAIL_AMOUNT = new RegExp(`引落金額${SEP}([\\d,]+)[ \\t]*円`)
const DETAIL_CONTENT = new RegExp(`内容${SEP}(\\S.*)`)
/** カード引落の明細を見分ける「内容」の書き出し（他の口座振替が同じメールに混ざる） */
const CARD_SETTLEMENT_CONTENT_PREFIX = 'ミツイスミトモカード'

/** 文字化けの目印。iso-2022-jp のデコードに失敗した本文は置換文字が残る */
const REPLACEMENT_CHARACTER = '�'

/** `2,420` のようなカンマ区切り金額 → 数値。読めなければ null */
function parseAmount(raw: string): number | null {
  const value = Number(raw.replace(/,/g, ''))
  return Number.isSafeInteger(value) ? value : null
}

/** 本文構造を選ぶ順番。種別ヒントが指す構造から先に見る（08a §2 の事後条件） */
function kindOrder(hint: MailKindHint): readonly ParsableKind[] {
  const hinted = PARSABLE_KINDS.find(kind => kind === hint)
  return hinted === undefined
    ? PARSABLE_KINDS
    : [hinted, ...PARSABLE_KINDS.filter(k => k !== hinted)]
}

/**
 * カード利用のお知らせ。利用日は分単位の実時刻まで分かるため、暦日に丸めず実時刻で持つ
 * （JST 暦日は発生日時から導出できるので、発生日での重複除外には影響しない）。
 */
function parseCardUsage(
  text: string,
): { merchantName: string; amount: number; occurredAt: Date } | null {
  const date = CARD_USAGE_DATE.exec(text)
  const merchant = CARD_USAGE_MERCHANT.exec(text)
  const amountText = CARD_USAGE_AMOUNT.exec(text)
  if (date === null || merchant === null || amountText === null) return null

  const occurredAt = jstDateTimeToUtc(
    Number(date[1]),
    Number(date[2]),
    Number(date[3]),
    Number(date[4]),
    Number(date[5]),
  )
  const amount = parseAmount(amountText[1] ?? '')
  if (occurredAt === null || amount === null) return null

  // 事後条件（OQ-23）: 加盟店名は正規化して返す。表記が揺れたまま候補になると、同じ店が
  // 別の店として扱われ、自動分類の学習も三項一致の重複除外も効かなくなる
  const merchantName = normalizeMerchantName(merchant[1] ?? '')
  if (merchantName === '') return null
  return { merchantName, amount, occurredAt }
}

/**
 * 振込入金のお知らせ。入金日は日付のみで時刻が無いため、取込側の暦日表現（UTC 深夜 0 時）に
 * 揃える。振込元名は「内容」から接頭辞「振込サービス」を落としたもので、法人格が
 * 途中で切り詰められる（`エイ フオース(カ`）ことがあるため、そのままの表記で残す
 * （入金用途の判別は振込元名に頼らない 2 シグナル方式 — 08d / OQ-21）。
 */
function parseBankDeposit(
  text: string,
): { payerName: string; amount: number; occurredAt: Date; description: string } | null {
  const date = DEPOSIT_DATE.exec(text)
  const amountText = DEPOSIT_AMOUNT.exec(text)
  const content = DEPOSIT_CONTENT.exec(text)
  if (date === null || amountText === null || content === null) return null

  const occurredAt = utcMidnightOfJstCalendarDate(Number(date[1]), Number(date[2]), Number(date[3]))
  const amount = parseAmount(amountText[1] ?? '')
  if (occurredAt === null || amount === null) return null

  const description = (content[1] ?? '').trim()
  const payerName = description.replace(REMITTANCE_PREFIX, '').trim()
  if (payerName === '') return null
  return { payerName, amount, occurredAt, description }
}

/**
 * 口座引き落としの事前お知らせ。
 *
 * 対象月は本文に無いため引落予定日から導く: **対象月 = 引落予定日の前月**（OQ-1(1) 確定）。
 * 三井住友カードの引落は「月末締め・翌月26日頃」と「15日締め・翌月10日」があり夫婦で違いうるが、
 * どちらも締め月は引落予定日の前月になるので、引落日の「日」では分岐しない。
 *
 * 明細は複数並ぶ（電気代などの口座振替が同じメールに載る）。カード引落は「内容」が
 * `ミツイスミトモカード` で始まる明細に限り、複数あれば合算する（カードが 2 枚あっても
 * その月にこの口座から落ちるカード引落の合計になる）。1 件も無いメールは
 * 「カード引落確定」としては必須の値が無いため必須フィールド欠落として扱う。
 */
function parseCardSettlement(
  text: string,
): { totalAmount: number; settlementDate: Date; targetMonth: string } | null {
  const date = SETTLEMENT_DATE.exec(text)
  if (date === null) return null
  const year = Number(date[1])
  const month = Number(date[2])
  const settlementDate = utcMidnightOfJstCalendarDate(year, month, Number(date[3]))
  if (settlementDate === null) return null

  const details = text.split(DETAIL_SEPARATOR).slice(1)
  let totalAmount = 0
  let cardDetailCount = 0
  for (const detail of details) {
    const content = DETAIL_CONTENT.exec(detail)
    if (content === null || !(content[1] ?? '').startsWith(CARD_SETTLEMENT_CONTENT_PREFIX)) continue
    const amountText = DETAIL_AMOUNT.exec(detail)
    const amount = amountText === null ? null : parseAmount(amountText[1] ?? '')
    if (amount === null) return null
    totalAmount += amount
    cardDetailCount++
  }
  if (cardDetailCount === 0) return null

  return { totalAmount, settlementDate, targetMonth: previousMonth(yearMonth(year, month)) }
}

/**
 * behavior SMBC通知メール本文をパースする（08a §2）
 *
 * 事後: メール種別ヒントから本文構造を選び、当たらなければ他の構造も見る
 * 事後: 加盟店名は NFKC 正規化＋空白圧縮＋長音統一 を適用して返す（OQ-23）
 * 事後: 例外は投げない。読めなかった本文は `parse_failure` として返し、
 *       どう読めなかったか（構造不一致 / 必須フィールド欠落 / 文字化け）を理由に残す
 */
export const parseSmbcNotificationMail: SmbcNotificationMailParser = ({
  mail,
  userId,
  at,
}: SmbcNotificationMailParseInput): SmbcMailParseResult => {
  const failure = (reason: MailParseFailureReason): SmbcMailParseResult =>
    SmbcMailParseResultSchema.parse({
      kind: 'parse_failure',
      gmailMessageId: mail.gmailMessageId,
      reason,
      detectedAt: at,
    })

  // 文字化けは構造不一致と区別する。文字コードの取り違えは実装の誤りで、
  // 「知らない書式のメールが届いた」のとは対処が違う（前者は直せば全件回復する）
  if (mail.body.includes(REPLACEMENT_CHARACTER)) return failure('garbled_text')

  const text = mail.body.normalize('NFKC')
  const kind = kindOrder(mail.kindHint).find(candidate => KIND_MARKERS[candidate].test(text))
  if (kind === undefined) return failure('structure_mismatch')

  const parsed = buildResult(kind, text, { gmailMessageId: mail.gmailMessageId, userId })
  if (parsed === null) return failure('missing_required_field')

  // 値の不変条件（金額が整数か・加盟店名が空でないか等）はスキーマに任せる。
  // 通らなかった本文は「必須の値が読めなかった」と同じ扱いにする（例外は投げない）
  const validated = SmbcMailParseResultSchema.safeParse(parsed)
  return validated.success ? validated.data : failure('missing_required_field')
}

/** 選んだ構造で本文を読む。読めなければ null（呼出し側が必須フィールド欠落として扱う） */
function buildResult(
  kind: ParsableKind,
  text: string,
  identity: { gmailMessageId: GmailMessageId; userId: UserId },
): object | null {
  if (kind === 'card_usage') {
    const fields = parseCardUsage(text)
    return fields === null ? null : { kind, ...identity, ...fields, cardKind: 'mitsui_sumitomo' }
  }
  if (kind === 'bank_deposit') {
    const fields = parseBankDeposit(text)
    return fields === null ? null : { kind, ...identity, ...fields }
  }
  const fields = parseCardSettlement(text)
  return fields === null ? null : { kind, ...identity, ...fields }
}
