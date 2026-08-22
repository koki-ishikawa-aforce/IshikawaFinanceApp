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
    expect(await repo.findByGmailMessageId('gm-email-1' as GmailMessageId)).toEqual(emailCandidate)
    expect(await repo.findByGmailMessageId('gm-smbc-1' as GmailMessageId)).toEqual(amazonCandidate)
    expect(await repo.findByGmailMessageId('gm-none' as GmailMessageId)).toBeNull()
  })

  it('同一 Gmail メッセージの重複 save は InvariantViolationError（partial unique）', async () => {
    await repo.save(normalCandidate({ gmailMessageId: 'gm-dup' }))
    await expect(repo.save(normalCandidate({ gmailMessageId: 'gm-dup' }))).rejects.toThrow(
      InvariantViolationError,
    )
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
