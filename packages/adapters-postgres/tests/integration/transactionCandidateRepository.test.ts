import { describe, it, expect } from 'vitest'
import type { GmailMessageId, Money, TransactionCandidateId } from '@warimaru/domain'
import {
  InvariantViolationError,
  MoneySchema,
  TransactionIdSchema,
  UploadFileIdSchema,
  confirmCandidate,
} from '@warimaru/domain'
import { db } from './setup'
import { newUlid } from '../../src/newId'
import { PostgresTransactionCandidateRepository } from '../../src/transaction-import/PostgresTransactionCandidateRepository'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import {
  amazonMatchedCandidate,
  csvCandidate,
  matchTimeoutCandidate,
  normalCandidate,
  pdfCandidate,
} from '../helpers/transactionImportFixtures'

const repo = new PostgresTransactionCandidateRepository(db)

describe('PostgresTransactionCandidateRepository', () => {
  it('save → findById の往復同一性（normal / amazon_matched / match_timeout 全変種）', async () => {
    for (const candidate of [
      normalCandidate(),
      amazonMatchedCandidate(),
      matchTimeoutCandidate(),
    ]) {
      await repo.save(candidate)
      expect(await repo.findById(candidate.common.transactionCandidateId)).toEqual(candidate)
    }
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as TransactionCandidateId)).toBeNull()
  })

  it('findByGmailMessageId は email 由来と amazon_match 由来（SMBC メール）の両方を引ける', async () => {
    const emailCandidate = normalCandidate({ gmailMessageId: 'gm-email-1' })
    const amazonCandidate = amazonMatchedCandidate({ smbcGmailMessageId: 'gm-smbc-1' })
    await repo.save(emailCandidate)
    await repo.save(amazonCandidate)
    expect(await repo.findByGmailMessageId(HONEY_USER_ID, 'gm-email-1' as GmailMessageId)).toEqual(
      emailCandidate,
    )
    expect(await repo.findByGmailMessageId(HONEY_USER_ID, 'gm-smbc-1' as GmailMessageId)).toEqual(
      amazonCandidate,
    )
    expect(await repo.findByGmailMessageId(HONEY_USER_ID, 'gm-none' as GmailMessageId)).toBeNull()
  })

  it('findByGmailMessageId は利用者に閉じる（別利用者の同一 Gmail ID は引かない、#487）', async () => {
    const honey = normalCandidate({ userId: HONEY_USER_ID, gmailMessageId: 'gm-shared' })
    await repo.save(honey)
    // 別利用者で同じ Gmail message ID を照会しても引かない
    expect(
      await repo.findByGmailMessageId(DARLING_USER_ID, 'gm-shared' as GmailMessageId),
    ).toBeNull()
  })

  it('別々の利用者は同一 Gmail message ID の候補を共存できる（#487。片方が黙って欠落しない）', async () => {
    // Gmail message ID は受信箱ごとの採番でアカウント間の一意性を保証しない。夫婦それぞれの
    // メールに同じ番号が振られても、双方が取り込めることを保証する（partial unique を
    // (user_id, gmail_message_id) で閉じたことの確認）。
    const honey = normalCandidate({ userId: HONEY_USER_ID, gmailMessageId: 'gm-collision' })
    const darling = normalCandidate({ userId: DARLING_USER_ID, gmailMessageId: 'gm-collision' })
    await repo.save(honey)
    await expect(repo.save(darling)).resolves.toBeUndefined()
    expect(
      await repo.findByGmailMessageId(HONEY_USER_ID, 'gm-collision' as GmailMessageId),
    ).toEqual(honey)
    expect(
      await repo.findByGmailMessageId(DARLING_USER_ID, 'gm-collision' as GmailMessageId),
    ).toEqual(darling)
  })

  it('同一利用者・同一 Gmail メッセージの重複 save は InvariantViolationError（partial unique）', async () => {
    await repo.save(normalCandidate({ userId: HONEY_USER_ID, gmailMessageId: 'gm-dup' }))
    await expect(
      repo.save(normalCandidate({ userId: HONEY_USER_ID, gmailMessageId: 'gm-dup' })),
    ).rejects.toThrow(InvariantViolationError)
  })

  it('Gmail ID なし（CSV 由来）は partial unique の対象外で複数共存できる', async () => {
    await expect(repo.save(csvCandidate())).resolves.toBeUndefined()
    await expect(repo.save(csvCandidate())).resolves.toBeUndefined()
  })

  it('findByTripleMatch は JST 暦日 + 金額 + 加盟店名で一致する', async () => {
    // UTC 7/4 15:30 = JST 7/5 00:30 → JST 暦日 2026-07-05
    const candidate = normalCandidate({
      merchantName: 'スーパーA',
      amount: 1200,
      occurredAt: new Date('2026-07-04T15:30:00.000Z'),
    })
    await repo.save(candidate)

    const money = (v: number): Money => MoneySchema.parse(v)
    // 同じ JST 暦日の別時刻（JST 7/5 23:00）で照会 → 一致
    const sameJstDay = new Date('2026-07-05T14:00:00.000Z')
    expect(
      await repo.findByTripleMatch(HONEY_USER_ID, sameJstDay, money(1200), 'スーパーA'),
    ).toEqual(candidate)
    // UTC 暦日は同じ 7/4 でも JST 暦日 7/4（= UTC 7/4 03:00）は不一致
    const prevJstDay = new Date('2026-07-04T03:00:00.000Z')
    expect(
      await repo.findByTripleMatch(HONEY_USER_ID, prevJstDay, money(1200), 'スーパーA'),
    ).toBeNull()
    // 金額・加盟店・ユーザーのいずれかが違えば不一致
    expect(
      await repo.findByTripleMatch(HONEY_USER_ID, sameJstDay, money(999), 'スーパーA'),
    ).toBeNull()
    expect(
      await repo.findByTripleMatch(HONEY_USER_ID, sameJstDay, money(1200), 'スーパーB'),
    ).toBeNull()
    expect(
      await repo.findByTripleMatch(DARLING_USER_ID, sameJstDay, money(1200), 'スーパーA'),
    ).toBeNull()
  })

  it('findByPdfFileId は pdf 由来の候補のみを pdfFileId 一致で返す', async () => {
    const pdfFileId = UploadFileIdSchema.parse(newUlid())
    const target1 = pdfCandidate({ pdfFileId, merchantName: 'PDFストアA' })
    const target2 = pdfCandidate({ pdfFileId, merchantName: 'PDFストアB', amount: 500 })
    const otherPdf = pdfCandidate({ pdfFileId: newUlid() })
    const csv = csvCandidate()
    for (const candidate of [target1, target2, otherPdf, csv]) {
      await repo.save(candidate)
    }
    const found = await repo.findByPdfFileId(pdfFileId)
    expect(found).toHaveLength(2)
    expect(found.map(c => c.common.transactionCandidateId).sort()).toEqual(
      [target1, target2].map(c => c.common.transactionCandidateId).sort(),
    )
  })

  it('findEmailSourcedNormalCandidates はメール由来・通常の候補だけを発生日の範囲で返す', async () => {
    // JST 暦日で 7/10・7/12・7/15 に当たる 3 件（UTC 表記）
    const jul10 = new Date('2026-07-10T03:00:00.000Z')
    const jul11 = new Date('2026-07-11T03:00:00.000Z')
    const jul12 = new Date('2026-07-12T03:00:00.000Z')
    const jul15 = new Date('2026-07-15T03:00:00.000Z')
    const inRangeEarly = normalCandidate({ occurredAt: jul10, merchantName: 'AMAZON CO JP' })
    const inRangeLate = normalCandidate({ occurredAt: jul12, merchantName: 'AMAZON CO JP' })
    const outOfRange = normalCandidate({ occurredAt: jul15 })
    const outOfRangeByJst = normalCandidate({
      // UTC 7/12 15:30 = JST 7/13 00:30 → occurredTo=jul12 の JST 暦日を超える
      occurredAt: new Date('2026-07-12T15:30:00.000Z'),
    })
    const otherUser = normalCandidate({ occurredAt: jul10, userId: DARLING_USER_ID })
    // メール由来でない候補（CSV / PDF）と、突合済み・タイムアウト済みの候補は返らない
    // （非 normal の 2 件は範囲内に置く。範囲外に置くと日付だけで落ちて kind の絞り込みが確認できない）
    const csv = csvCandidate({ occurredAt: jul10 })
    const pdf = pdfCandidate({ occurredAt: jul10 })
    const matched = amazonMatchedCandidate({ occurredAt: jul11 })
    const timedOut = matchTimeoutCandidate({ occurredAt: jul11 })
    for (const candidate of [
      inRangeEarly,
      inRangeLate,
      outOfRange,
      outOfRangeByJst,
      otherUser,
      csv,
      pdf,
      matched,
      timedOut,
    ]) {
      await repo.save(candidate)
    }

    const found = await repo.findEmailSourcedNormalCandidates(HONEY_USER_ID, {
      occurredFrom: jul10,
      occurredTo: jul12,
    })

    expect(found.map(c => c.common.transactionCandidateId).sort()).toEqual(
      [inRangeEarly, inRangeLate].map(c => c.common.transactionCandidateId).sort(),
    )
    expect(found.every(c => c.kind === 'normal')).toBe(true)
  })

  it('findEmailSourcedNormalCandidates は下限を省くと期限切れの掃き出し用に古い候補まで返す', async () => {
    const old = normalCandidate({ occurredAt: new Date('2026-01-05T03:00:00.000Z') })
    const recent = normalCandidate({ occurredAt: new Date('2026-07-20T03:00:00.000Z') })
    await repo.save(old)
    await repo.save(recent)

    const found = await repo.findEmailSourcedNormalCandidates(HONEY_USER_ID, {
      occurredTo: new Date('2026-07-10T03:00:00.000Z'),
    })

    const ids = found.map(c => c.common.transactionCandidateId)
    expect(ids).toContain(old.common.transactionCandidateId)
    expect(ids).not.toContain(recent.common.transactionCandidateId)
  })

  it('findMatchedAmazonOrderIds は突合済みの Amazon 注文ID だけを返す（他ユーザーは含めない）', async () => {
    const mine = amazonMatchedCandidate({ smbcGmailMessageId: 'gm-smbc-mine' })
    const spouse = amazonMatchedCandidate({
      userId: DARLING_USER_ID,
      smbcGmailMessageId: 'gm-smbc-spouse',
    })
    const normal = normalCandidate({ gmailMessageId: 'gm-not-matched' })
    for (const candidate of [mine, spouse, normal]) {
      await repo.save(candidate)
    }
    if (mine.common.importSource.kind !== 'amazon_match')
      throw new Error('fixture が amazon_match でない')
    if (spouse.common.importSource.kind !== 'amazon_match')
      throw new Error('fixture が amazon_match でない')
    const mineOrderId = mine.common.importSource.amazonOrderId
    const spouseOrderId = spouse.common.importSource.amazonOrderId
    const unknownId = '250-0000000-0000000' as never

    const found = await repo.findMatchedAmazonOrderIds(HONEY_USER_ID, [
      mineOrderId,
      spouseOrderId,
      unknownId,
    ])

    expect(found).toEqual([mineOrderId])
  })

  it('confirmed 候補を save → findById で往復できる（kind CHECK 拡張の確認）', async () => {
    const candidate = csvCandidate()
    if (candidate.kind !== 'normal') throw new Error('fixture が normal でない')
    const confirmed = confirmCandidate(
      candidate,
      TransactionIdSchema.parse(candidate.common.transactionCandidateId),
      new Date('2026-07-07T00:00:00.000Z'),
    )
    await repo.save(confirmed)
    expect(await repo.findById(candidate.common.transactionCandidateId)).toEqual(confirmed)
  })
})
