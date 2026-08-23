import { describe, it, expect } from 'vitest'
import {
  emptyEmployerRemitterDirectory,
  recordBankDeposit,
  registerEmployerRemitterFromDeposit,
} from '@warimaru/domain'
import type { DeterminedBankDeposit, UserId } from '@warimaru/domain'
import { db } from './setup'
import { PostgresEmployerRemitterDirectoryRepository } from '../../src/balance-asset-tracking/PostgresEmployerRemitterDirectoryRepository'
import { employerRemitterNames } from '../../src/schema'
import { newUlid } from '../../src/newId'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'

const repo = new PostgresEmployerRemitterDirectoryRepository(db)

const EMPLOYER = '振込サービス ｶ)ﾜﾘﾏﾙｼｮｳｼﾞ'
const AT = new Date('2026-07-21T03:00:00.000Z')

/** 勤務先からの入金として確定済みの入金（名簿登録の入力） */
function determinedDeposit(
  input: { userId?: UserId; remitterName?: string; occurredAt?: Date } = {},
): DeterminedBankDeposit {
  const occurredAt = input.occurredAt ?? AT
  return recordBankDeposit({
    common: {
      bankDepositId: newUlid(),
      accountId: newUlid(),
      transactionId: newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      amount: 300000,
      occurredAt,
      remitterName: input.remitterName ?? EMPLOYER,
      determinedAt: occurredAt,
    } as never,
    purpose: { kind: 'salary' },
    expenseReimbursementId: newUlid() as never,
  }) as DeterminedBankDeposit
}

/** 名簿に 1 件登録した状態を作る */
function directoryWith(
  userId: UserId,
  input: { remitterName?: string; at?: Date } = {},
): ReturnType<typeof registerEmployerRemitterFromDeposit> {
  return registerEmployerRemitterFromDeposit(emptyEmployerRemitterDirectory(userId), {
    deposit: determinedDeposit({
      userId,
      ...(input.remitterName ? { remitterName: input.remitterName } : {}),
    }),
    operatorUserId: userId,
    at: input.at ?? AT,
  })
}

describe('PostgresEmployerRemitterDirectoryRepository', () => {
  it('登録が無ければ空の名簿を返す（未登録の利用者も名簿として扱える）', async () => {
    expect(await repo.findByOwner(HONEY_USER_ID)).toEqual(
      emptyEmployerRemitterDirectory(HONEY_USER_ID),
    )
  })

  it('save → findByOwner の往復同一性', async () => {
    const directory = directoryWith(HONEY_USER_ID)
    await repo.save(directory)
    expect(await repo.findByOwner(HONEY_USER_ID)).toEqual(directory)
  })

  it('否定形: 配偶者が登録した勤務先は本人の名簿に現れない（プライバシー3段階ルール）', async () => {
    await repo.save(directoryWith(DARLING_USER_ID))

    expect((await repo.findByOwner(HONEY_USER_ID)).entries).toEqual([])
    expect((await repo.findByOwner(DARLING_USER_ID)).entries).toHaveLength(1)
  })

  it('夫婦が同じ勤務先を登録しても互いに独立して保持される（利用者ごとの名簿）', async () => {
    await repo.save(directoryWith(HONEY_USER_ID))
    await repo.save(directoryWith(DARLING_USER_ID))

    expect((await repo.findByOwner(HONEY_USER_ID)).entries).toHaveLength(1)
    expect((await repo.findByOwner(DARLING_USER_ID)).entries).toHaveLength(1)
  })

  it('同じ名簿を再 save しても行は増えず、最初の登録日時を保つ（確定のやり直しで壊れない）', async () => {
    const first = directoryWith(HONEY_USER_ID)
    await repo.save(first)
    // 同じ振込元・別の登録日時で保存し直す（前方回復での再実行に相当）
    await repo.save({
      userId: HONEY_USER_ID,
      entries: first.entries.map(e => ({
        ...e,
        registeredAt: new Date('2026-09-01T00:00:00.000Z'),
      })),
    })

    const stored = await repo.findByOwner(HONEY_USER_ID)
    expect(stored.entries).toHaveLength(1)
    expect(stored.entries[0]?.registeredAt).toEqual(AT)
  })

  it('勤務先を追加すると登録順（古い順）で返る', async () => {
    const first = directoryWith(HONEY_USER_ID)
    await repo.save(first)
    const second = registerEmployerRemitterFromDeposit(first, {
      deposit: determinedDeposit({ remitterName: 'ｶ)ﾜﾘﾏﾙﾃｸﾉﾛｼﾞｰｽﾞ' }),
      operatorUserId: HONEY_USER_ID,
      at: new Date('2026-08-21T03:00:00.000Z'),
    })
    await repo.save(second)

    expect((await repo.findByOwner(HONEY_USER_ID)).entries.map(e => e.normalizedName)).toEqual([
      '振込サービス カ)ワリマルショウジ',
      'カ)ワリマルテクノロジーズ',
    ])
  })

  it('空の名簿の save は行を作らない', async () => {
    await repo.save(emptyEmployerRemitterDirectory(HONEY_USER_ID))
    expect(await db.select().from(employerRemitterNames)).toHaveLength(0)
  })
})
