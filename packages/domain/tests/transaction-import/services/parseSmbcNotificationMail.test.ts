/**
 * SMBC 通知メールのパース（#415 / OQ-1(1)）
 *
 * 本文は実メール 3 通（Issue #415 の実メールフォーマット確定コメント）の書式をそのまま写している。
 * 全角コロン・全角スペース詰め・全角英字は実メールの表記なので、テストからも落とさない
 * （半角に直して書くと、正規化が壊れても気づけなくなる）。
 */
import { describe, it, expect } from 'vitest'
import { parseSmbcNotificationMail } from '../../../src/transaction-import/services/parseSmbcNotificationMail'
import type {
  MailKindHint,
  SmbcNotificationMailBody,
} from '../../../src/transaction-import/services/GmailMailFetchGateway'
import type { GmailMessageId, UserId } from '../../../src/shared/ids'

const AT = new Date('2026-07-20T10:00:00+09:00')
const USER_ID = 'user_honey' as UserId
const GMAIL_MESSAGE_ID = 'gmail-1' as GmailMessageId

const CARD_USAGE_BODY = `石川 様

いつも三井住友カードをご利用頂きありがとうございます。
お客様のカードご利用内容をお知らせいたします。'

ご利用カード：Ｏｌｉｖｅ  ゴールド／クレジット

◇利用日：2026/07/15 14:37
◇利用先：AMAZON CO JP
◇利用取引：買物
◇利用金額：2,420円
`

const BANK_DEPOSIT_BODY = `イシカワ コウキさま

三井住友銀行より、以下の振込入金についてお知らせします。

入金口座： ×××× 支店 残高別普通 口座番号1234567
入金日 ： 2026年07月13日
金額  ： 30,014円
内容  ： 振込サービス エイ フオース(カ

（2026年07月13日18時46分現在（配信番号： 0000000000-0010））
`

const CARD_SETTLEMENT_BODY = `イシカワ コウキさま

三井住友銀行より、以下の口座引き落としについて事前にお知らせします。

口座引落予定日： 2026年07月27日

◆明細１
引落口座： ×××× 支店 残高別普通 口座番号1234567
引落金額： 247,052円
内容\u3000： ミツイスミトモカード (カ

（2026年07月23日18時00分現在（配信番号： 0000000000-0010））
`

function parse(body: string, kindHint: MailKindHint = 'unknown') {
  const mail: SmbcNotificationMailBody = {
    gmailMessageId: GMAIL_MESSAGE_ID,
    receivedAt: new Date('2026-07-15T14:40:00+09:00'),
    subject: '（件名は本文構造の判定に使わない）',
    body,
    kindHint,
  }
  return parseSmbcNotificationMail({ mail, userId: USER_ID, at: AT })
}

describe('カード利用のお知らせ', () => {
  it('実メールの本文から利用先・金額・利用日時を取り出す', () => {
    expect(parse(CARD_USAGE_BODY, 'card_usage')).toEqual({
      kind: 'card_usage',
      gmailMessageId: GMAIL_MESSAGE_ID,
      userId: USER_ID,
      merchantName: 'AMAZON CO JP',
      amount: 2420,
      // 利用日時は JST の実時刻。暦日に丸めない
      occurredAt: new Date('2026-07-15T14:37:00+09:00'),
      cardKind: 'mitsui_sumitomo',
    })
  })

  it('加盟店名を正規化して返す（全角英数・空白の連続・カタカナ直後のハイフン）', () => {
    const result = parse(
      CARD_USAGE_BODY.replace('AMAZON CO JP', 'ＳＵＰＥＲ\u3000\u3000スーパ-西口店'),
    )
    expect(result).toMatchObject({ kind: 'card_usage', merchantName: 'SUPER スーパー西口店' })
  })

  it('種別ヒントが無くても本文構造から種別を決める', () => {
    expect(parse(CARD_USAGE_BODY, 'unknown')).toMatchObject({ kind: 'card_usage' })
  })

  it('種別ヒントが本文と食い違っても、本文構造の側を採る', () => {
    // 件名・送信元から付くヒントは暫定値（08a §1）。本文に無い種別として読むと値が空になる
    expect(parse(CARD_USAGE_BODY, 'bank_deposit')).toMatchObject({ kind: 'card_usage' })
  })

  it('持ち主は呼出し側が渡したユーザーになる（本文に現れる宛名で決めない）', () => {
    expect(parse(CARD_USAGE_BODY.replace('石川 様', '別人 様'))).toMatchObject({ userId: USER_ID })
  })

  it('金額のカンマ区切りを桁数によらず読む', () => {
    expect(parse(CARD_USAGE_BODY.replace('2,420円', '1,234,567円'))).toMatchObject({
      amount: 1234567,
    })
  })

  it('全角の数字・カンマで書かれた金額も読む', () => {
    expect(parse(CARD_USAGE_BODY.replace('2,420円', '２，４２０円'))).toMatchObject({
      amount: 2420,
    })
  })

  it('本文どおりの 0 円はそのまま 0 円として読む（金額を勝手に変えない）', () => {
    expect(parse(CARD_USAGE_BODY.replace('2,420円', '0円'))).toMatchObject({
      kind: 'card_usage',
      amount: 0,
    })
  })

  it('数字を 1 桁も含まない金額を 0 円の取引にしない', () => {
    // `Number('')` は 0 になるため、桁が壊れたメールが静かに 0 円の候補として入りうる
    expect(parse(CARD_USAGE_BODY.replace('2,420円', ',,,円'))).toMatchObject({
      kind: 'parse_failure',
      reason: 'missing_required_field',
    })
  })

  it('安全に扱えない桁数の金額は取引候補にしない', () => {
    expect(parse(CARD_USAGE_BODY.replace('2,420円', '9,007,199,254,740,993円'))).toMatchObject({
      kind: 'parse_failure',
      reason: 'missing_required_field',
    })
  })

  it('改行コードが CRLF の本文でも同じ結果になる（実メールは CRLF で届く）', () => {
    expect(parse(CARD_USAGE_BODY.replace(/\n/g, '\r\n'))).toEqual(parse(CARD_USAGE_BODY))
  })

  it('利用金額の行が無い本文は必須フィールド欠落として返す', () => {
    expect(parse(CARD_USAGE_BODY.replace('◇利用金額：2,420円', ''), 'card_usage')).toEqual({
      kind: 'parse_failure',
      gmailMessageId: GMAIL_MESSAGE_ID,
      reason: 'missing_required_field',
      detectedAt: AT,
    })
  })

  it('利用先が空の本文は取引候補にせず必須フィールド欠落として返す', () => {
    const result = parse(CARD_USAGE_BODY.replace('◇利用先：AMAZON CO JP', '◇利用先：'))
    expect(result).toMatchObject({ kind: 'parse_failure', reason: 'missing_required_field' })
  })

  it('実在しない利用日は別の日に繰り上げず必須フィールド欠落として返す', () => {
    const result = parse(CARD_USAGE_BODY.replace('2026/07/15 14:37', '2026/02/30 14:37'))
    expect(result).toMatchObject({ kind: 'parse_failure', reason: 'missing_required_field' })
  })
})

describe('振込入金のお知らせ', () => {
  it('実メールの本文から振込元名・金額・入金日を取り出す', () => {
    expect(parse(BANK_DEPOSIT_BODY, 'bank_deposit')).toEqual({
      kind: 'bank_deposit',
      gmailMessageId: GMAIL_MESSAGE_ID,
      userId: USER_ID,
      // 法人格が途中で切り詰められる実メールの表記をそのまま残す（用途判別は振込元名に頼らない）
      payerName: 'エイ フオース(カ',
      amount: 30014,
      // 入金日は日付のみ。取込側の暦日表現（UTC 深夜 0 時 = JST 同日）に揃える
      occurredAt: new Date('2026-07-13T00:00:00Z'),
      description: '振込サービス エイ フオース(カ',
    })
  })

  it('「振込サービス」の接頭辞が無い内容は、そのまま振込元名として扱う', () => {
    const result = parse(
      BANK_DEPOSIT_BODY.replace('振込サービス エイ フオース(カ', 'キユウヨ フリコミ'),
    )
    expect(result).toMatchObject({
      payerName: 'キユウヨ フリコミ',
      description: 'キユウヨ フリコミ',
    })
  })

  it('引落金額の行を入金額と取り違えない', () => {
    // 「金額」を含む別ラベルが本文にあっても、入金額は行頭の「金額」から読む
    const result = parse(
      BANK_DEPOSIT_BODY.replace('入金口座：', '引落金額： 999,999円\n入金口座：'),
    )
    expect(result).toMatchObject({ amount: 30014 })
  })

  it.each([
    ['入金日', '入金日 ： 2026年07月13日'],
    ['金額', '金額  ： 30,014円'],
    ['内容', '内容  ： 振込サービス エイ フオース(カ'],
  ])('%s の行が無い本文は必須フィールド欠落として返す', (_label, line) => {
    const result = parse(BANK_DEPOSIT_BODY.replace(line, ''), 'bank_deposit')
    expect(result).toMatchObject({ kind: 'parse_failure', reason: 'missing_required_field' })
  })
})

describe('口座引き落としの事前お知らせ', () => {
  it('実メールの本文から引落金額・引落予定日を取り出し、対象月を前月として導く', () => {
    expect(parse(CARD_SETTLEMENT_BODY, 'card_settlement_confirmed')).toEqual({
      kind: 'card_settlement_confirmed',
      gmailMessageId: GMAIL_MESSAGE_ID,
      userId: USER_ID,
      totalAmount: 247052,
      settlementDate: new Date('2026-07-27T00:00:00Z'),
      targetMonth: '2026-06',
    })
  })

  it('対象月の導出は引落日の「日」で分岐しない（15日締め・翌月10日払いでも前月）', () => {
    const result = parse(CARD_SETTLEMENT_BODY.replace('2026年07月27日', '2026年07月10日'))
    expect(result).toMatchObject({ targetMonth: '2026-06' })
  })

  it('1 月引落は前年 12 月を対象月にする', () => {
    const result = parse(CARD_SETTLEMENT_BODY.replace('2026年07月27日', '2027年01月26日'))
    expect(result).toMatchObject({ targetMonth: '2026-12' })
  })

  it('カード引落以外の明細が混ざっていても、カード引落の金額だけを読む', () => {
    const withUtility = CARD_SETTLEMENT_BODY.replace(
      '◆明細１',
      `◆明細１
引落口座： ×××× 支店 残高別普通 口座番号1234567
引落金額： 8,900円
内容\u3000： カンサイデンリヨク

◆明細２`,
    )
    expect(withUtility).toContain('カンサイデンリヨク')
    expect(parse(withUtility)).toMatchObject({ totalAmount: 247052 })
  })

  it('カード引落の明細が複数あれば合算する', () => {
    const twoCards = `${CARD_SETTLEMENT_BODY}
◆明細２
引落口座： ×××× 支店 残高別普通 口座番号1234567
引落金額： 12,000円
内容\u3000： ミツイスミトモカード (カ
`
    expect(parse(twoCards)).toMatchObject({ totalAmount: 259052 })
  })

  it.each([
    ['引落予定日の行が無い', (b: string) => b.replace('口座引落予定日： 2026年07月27日', '')],
    ['引落予定日が実在しない', (b: string) => b.replace('2026年07月27日', '2026年02月30日')],
    // 1 件でも読めない明細があると合計が過少になるため、メール全体を失敗にする
    ['カード明細に引落金額が無い', (b: string) => b.replace('引落金額： 247,052円', '')],
  ])('%s引落通知は必須フィールド欠落として返す', (_label, mutate) => {
    expect(parse(mutate(CARD_SETTLEMENT_BODY), 'card_settlement_confirmed')).toMatchObject({
      kind: 'parse_failure',
      reason: 'missing_required_field',
    })
  })

  it('カード引落の明細が 1 件も無い引落通知は必須フィールド欠落として返す', () => {
    const utilityOnly = CARD_SETTLEMENT_BODY.replace(
      'ミツイスミトモカード (カ',
      'カンサイデンリヨク',
    )
    expect(parse(utilityOnly, 'card_settlement_confirmed')).toMatchObject({
      kind: 'parse_failure',
      reason: 'missing_required_field',
    })
  })
})

describe('読めない本文', () => {
  it('知らない書式の本文は構造不一致として返す', () => {
    expect(parse('三井住友銀行からのお知らせです。\n詳しくはアプリをご確認ください。')).toEqual({
      kind: 'parse_failure',
      gmailMessageId: GMAIL_MESSAGE_ID,
      reason: 'structure_mismatch',
      detectedAt: AT,
    })
  })

  it('実メールが観測されていない種別（出金通知）のヒントが付いても、当てずっぽうで読まない', () => {
    const withdrawal = `イシカワ コウキさま

三井住友銀行より、以下のお引き出しについてお知らせします。

お引出日 ： 2026年07月13日
金額  ： 30,014円
`
    expect(parse(withdrawal, 'bank_withdrawal')).toMatchObject({
      kind: 'parse_failure',
      reason: 'structure_mismatch',
    })
  })

  it('文字化けした本文は構造不一致と区別して返す', () => {
    // iso-2022-jp のデコードに失敗した本文には置換文字（U+FFFD）が残る
    expect(parse('���� ��p�̂��m�点', 'card_usage')).toMatchObject({
      kind: 'parse_failure',
      reason: 'garbled_text',
    })
  })

  it('構造は読める本文でも、加盟店名が文字化けしていれば取引候補にしない', () => {
    // 化けた加盟店名のまま候補にすると、同じ店が別の店として家計簿に入り、
    // 三項一致の重複除外も自動分類の学習も静かに外れる（OQ-23）
    expect(parse(CARD_USAGE_BODY.replace('AMAZON CO JP', 'AM�ZON'), 'card_usage')).toMatchObject({
      kind: 'parse_failure',
      reason: 'garbled_text',
    })
  })

  it('構造は読める振込入金でも、内容が文字化けしていれば取引候補にしない', () => {
    expect(parse(BANK_DEPOSIT_BODY.replace('エイ フオース', 'エイ ���ス'))).toMatchObject({
      kind: 'parse_failure',
      reason: 'garbled_text',
    })
  })

  it('本文が空なら構造不一致として返す（例外は投げない）', () => {
    expect(parse('')).toMatchObject({ kind: 'parse_failure', reason: 'structure_mismatch' })
  })

  it('2 種の目印に当たる本文は、種別ヒントが指す構造で読む', () => {
    // 目印は基本的に排他だが、定型文が別種のものと混ざることはありうる。
    // そのときどちらで読むかを決めるのが種別ヒント（08a §2 の事後条件）
    const ambiguous = `${CARD_SETTLEMENT_BODY}
（本メールは振込入金についてのお知らせと同じ配信基盤で送信しています）
入金日 ： 2026年07月13日
金額  ： 30,014円
内容  ： 振込サービス エイ フオース(カ
`
    expect(parse(ambiguous, 'card_settlement_confirmed')).toMatchObject({
      kind: 'card_settlement_confirmed',
    })
    expect(parse(ambiguous, 'bank_deposit')).toMatchObject({ kind: 'bank_deposit' })
  })
})
