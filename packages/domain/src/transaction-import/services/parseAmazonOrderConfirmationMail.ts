/**
 * Amazon 注文確認メール本文のパース実装（08a §2「Amazon注文確認メール本文をパースする」/ OQ-1(4)）
 *
 * Amazon から届く注文確認メールの本文から、カード利用通知と突き合わせるための材料
 * （注文番号・注文合計金額・商品名）を取り出す。抽出規則は 2026-07-26 の実メール観察
 * （#391 のコメント）で確認した `text/plain` パートの行構造に沿う:
 *
 * ```
 * 注文番号: 250-1234567-1234567
 * ...
 * * マスタリングTCP/IP―入門編―(第6版)
 *   数量: 1
 *   2420 JPY
 * ...
 * 合計 2420 JPY
 * ```
 *
 * `text/plain` を正とするのは同じ観察による（印刷 PDF では合計が ¥0 に見えるケースがあった）。
 * 本文の取り出し（MIME パートの選択）は Gmail 取得側（ACL）の責務で、ここには文字列だけが届く。
 *
 * ドメインの純粋関数として書く（zod のみ・I/O 依存なし）。例外は投げず、読めなかったものは
 * `parse_failure` として返す — 1 通の異常で日次取込全体を止めないため。当てずっぽうの規則で
 * 誤った金額を通すより、パース失敗として件数に出るほうが気づける（`parseSmbcNotificationMail`
 * と同じ方針）。
 *
 * **注文日時は本文から読まず、メールの受信日時を使う。** 注文確認メールは注文の直後に届くため
 * （実測: 7/15 09:53 の注文確認 → 同日 14:37 のカード利用通知）、受信日時が注文日時の十分な
 * 近似になる。本文側の注文日表記は実メールで確認できていないため、確認できていない書式に
 * 規則を当てるより、Gmail が付ける確かな値を使う。
 */
import { MoneySchema, type Money } from '../../shared/value-objects/Money'
import { AmazonOrderIdSchema, type AmazonOrderId } from '../../shared/ids'
import {
  AmazonMailParseResultSchema,
  type AmazonMailParseResult,
} from '../value-objects/AmazonMailParseResult'
import type { AmazonProductInfo } from '../value-objects/AmazonOrderInfo'
import type {
  AmazonOrderConfirmationMailParseInput,
  AmazonOrderConfirmationMailParser,
} from './AmazonOrderConfirmationMailParser'

/**
 * Amazon の注文番号の書式（`250-1234567-1234567`）。ラベルの文言に依存せず本文のどこにあっても
 * 拾えるようにしてある — 注文番号は明細ページの URL にも同じ形で現れるため、ラベル行を頼りに
 * すると文言が変わっただけで読めなくなる。
 */
const ORDER_ID = /\b(\d{3}-\d{7}-\d{7})\b/

/**
 * 注文合計の行。`合計 2420 JPY`（実メール観察）のほか、請求額のラベルでも拾う。
 *
 * 突き合わせる相手はカードに請求された金額なので、`ご請求額` があればそちらを優先する
 * （ギフト券の利用などで「合計」と請求額が食い違う場合、カード利用通知に載るのは請求額）。
 */
const BILLED_TOTAL = /^[ \t]*ご?請求額[ \t:：]*([\d,]+)[ \t]*JPY/m
const ORDER_TOTAL = /^[ \t]*(?:注文)?合計[ \t:：]*([\d,]+)[ \t]*JPY/m

/**
 * 商品ブロックの先頭行（`* 商品名`）。箇条書きは商品以外（お届け先の案内など）にも使われるため、
 * 商品と認めるのは「数量」行と金額行を伴うブロックだけにする（`parseProducts`）。
 */
const PRODUCT_BULLET = /^[ \t]*\*[ \t]*(\S.*)$/
const PRODUCT_QUANTITY = /^[ \t]*数量[ \t:：]*\d+/m
const PRODUCT_AMOUNT = /^[ \t]*([\d,]+)[ \t]*JPY[ \t]*$/m

/** 文字化けの目印。デコードに失敗した本文は置換文字が残る */
const REPLACEMENT_CHARACTER = '�'

/**
 * `2,420` のようなカンマ区切り金額 → 金額。読めなければ null。
 *
 * 数字を 1 桁も含まない一致を 0 円として通さないのは `parseSmbcNotificationMail` と同じ理由
 * （`Number('')` は 0 になるため、桁が壊れたメールが 0 円の注文として静かに通る）。
 */
function parseAmount(raw: string): Money | null {
  if (!/\d/.test(raw)) return null
  const parsed = MoneySchema.safeParse(Number(raw.replace(/,/g, '')))
  return parsed.success ? parsed.data : null
}

/** 注文合計。請求額があればそちらを、無ければ合計を採る */
function parseOrderTotal(text: string): Money | null {
  const billed = BILLED_TOTAL.exec(text)
  if (billed !== null) return parseAmount(billed[1] ?? '')
  const total = ORDER_TOTAL.exec(text)
  return total === null ? null : parseAmount(total[1] ?? '')
}

/**
 * 商品ブロックを切り出して商品名と商品金額を取る。
 *
 * 箇条書きの行を起点に、次の箇条書き（または本文末尾）までをそのブロックとみなす。ブロックに
 * 「数量」行と金額行の**両方**が揃っているものだけを商品として扱う。片方しか無い箇条書きは
 * 商品以外の案内なので、商品名として取り込むと注文と関係のない文言が家計簿に出る。
 */
function parseProducts(text: string): AmazonProductInfo[] {
  const lines = text.split('\n')
  const bulletIndexes = lines.flatMap((line, index) => (PRODUCT_BULLET.test(line) ? [index] : []))
  return bulletIndexes.flatMap((start, i) => {
    const end = bulletIndexes[i + 1] ?? lines.length
    const productName = (PRODUCT_BULLET.exec(lines[start] ?? '')?.[1] ?? '').trim()
    const block = lines.slice(start + 1, end).join('\n')
    if (productName === '' || !PRODUCT_QUANTITY.test(block)) return []
    const amountText = PRODUCT_AMOUNT.exec(block)
    if (amountText === null) return []
    const productAmount = parseAmount(amountText[1] ?? '')
    return productAmount === null ? [] : [{ productName, productAmount }]
  })
}

function failure(
  input: AmazonOrderConfirmationMailParseInput,
  reason: 'structure_mismatch' | 'missing_required_field' | 'garbled_text',
): AmazonMailParseResult {
  return AmazonMailParseResultSchema.parse({
    kind: 'parse_failure',
    gmailMessageId: input.mail.gmailMessageId,
    reason,
    detectedAt: input.at,
  })
}

/**
 * 本文を NFKC 正規化してから規則を当てる（`parseSmbcNotificationMail` と同じ理由。全角コロン・
 * 全角数字で届いても同じ規則で読めるようにする）。商品名だけは正規化前の表記を保ちたくなるが、
 * 全角・半角の揺れは表示のたびに目に付くため、ここでも正規化済みの表記を採る。
 */
export const parseAmazonOrderConfirmationMail: AmazonOrderConfirmationMailParser = input => {
  const raw = input.mail.body
  if (raw.includes(REPLACEMENT_CHARACTER)) return failure(input, 'garbled_text')

  const text = raw.normalize('NFKC')
  const orderIdText = ORDER_ID.exec(text)
  if (orderIdText === null) return failure(input, 'structure_mismatch')

  const orderTotal = parseOrderTotal(text)
  const products = parseProducts(text)
  if (orderTotal === null || products.length === 0) return failure(input, 'missing_required_field')

  const amazonOrderId: AmazonOrderId = AmazonOrderIdSchema.parse(orderIdText[1])
  const parsed = AmazonMailParseResultSchema.safeParse({
    kind: 'order_confirmation',
    order: {
      amazonOrderId,
      userId: input.userId,
      gmailMessageId: input.mail.gmailMessageId,
      orderedAt: input.mail.receivedAt,
      orderTotal,
      products,
    },
  })
  // 個々の値は上で確かめているが、スキーマ側の不変条件（商品 1 件以上など）が将来増えたときに
  // 例外で取込を止めないよう、ここでも失敗として返す
  return parsed.success ? parsed.data : failure(input, 'missing_required_field')
}
