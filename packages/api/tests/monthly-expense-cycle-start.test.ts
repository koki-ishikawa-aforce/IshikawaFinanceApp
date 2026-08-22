/**
 * 月初の月次経費サイクル自動開始（#413。08e §2「月次経費サイクルをリセットする」）のテスト。
 *
 * 起動はスケジューラ（#416 の Lambda エントリポイント）からの想定のため、ルートを介さず
 * 適用モジュールを直接呼び、冪等性・失敗の分離・イベント発行を固定する。
 */
import { describe, it, expect, vi } from 'vitest'
import { MonthlyExpenseCycleSchema, registerAppUser } from '@warimaru/domain'
import type {
  MonthlyExpenseCycle,
  MonthlyExpenseCycleStarted,
  UserId,
  UserRole,
  YearMonth,
} from '@warimaru/domain'
import {
  startMonthlyExpenseCycleForUser,
  startMonthlyExpenseCyclesForHousehold,
  type HouseholdMonthlyExpenseCycleStartOutcome,
} from '../src/monthly-expense-cycle-start.js'
import { createTestApp, SPOUSE_ID, VIEWER_ID, type TestApp } from './helpers/test-app.js'

const TARGET_MONTH = '2026-07' as YearMonth
const AT = new Date('2026-07-01T00:00:00+09:00')

async function registerHousehold(t: TestApp): Promise<void> {
  await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
  await t.deps.appUserRepository.save(registerAppUser(SPOUSE_ID, 'darling', undefined, AT))
}

function collectStarted(t: TestApp): MonthlyExpenseCycleStarted[] {
  const log: MonthlyExpenseCycleStarted[] = []
  t.deps.eventBus.subscribe<MonthlyExpenseCycleStarted>('MonthlyExpenseCycleStarted', e => {
    log.push(e)
  })
  return log
}

function resultOf(outcome: HouseholdMonthlyExpenseCycleStartOutcome, role: UserRole) {
  return outcome.results.find(r => r.role === role)
}

/** 経費が積まれた進行中のサイクル（再実行で上書きされないことの検証用） */
function cycleWithAccumulation(userId: UserId, cycleId: string): MonthlyExpenseCycle {
  return MonthlyExpenseCycleSchema.parse({
    kind: 'accumulating',
    common: {
      monthlyExpenseCycleId: cycleId,
      userId,
      targetYearMonth: TARGET_MONTH,
      cycleStartedAt: AT,
      accumulations: [
        {
          kind: 'capped',
          accumulationId: '01ACC000000000000000000001',
          expenseTypeId: '01EXP000000000000000000001',
          userId,
          monthlyCap: 10000,
          currentTotal: 8000,
          capReached: { kind: 'not_reached' },
          transactionRefs: [
            {
              transactionId: '01TXA000000000000000000001',
              occurredAt: AT,
              amount: 8000,
              allocation: { kind: 'full' },
            },
          ],
        },
      ],
      childTransactionRefs: [],
    },
  })
}

describe('月初の月次経費サイクル自動開始（世帯一括）', () => {
  it('夫婦それぞれの集積中サイクルが作られ、MonthlyExpenseCycleStarted が発行される', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const log = collectStarted(t)

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })

    expect(resultOf(outcome, 'honey')?.status).toBe('started')
    expect(resultOf(outcome, 'darling')?.status).toBe('started')

    for (const userId of [VIEWER_ID, SPOUSE_ID]) {
      const cycle = await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(
        userId,
        TARGET_MONTH,
      )
      expect(cycle).toMatchObject({
        kind: 'accumulating',
        common: { targetYearMonth: TARGET_MONTH, accumulations: [], childTransactionRefs: [] },
      })
      expect(cycle?.common.cycleStartedAt).toEqual(AT)
      // 発行されたイベントは、実際に保存されたサイクルを指している
      expect(log.find(e => e.userId === userId)?.monthlyExpenseCycleId).toBe(
        cycle?.common.monthlyExpenseCycleId,
      )
    }

    expect(log).toHaveLength(2)
    expect(log.every(e => e.targetYearMonth === TARGET_MONTH)).toBe(true)
  })

  it('対象年月を省略すると JST 暦の当月を開始する（UTC ではまだ前月の時刻でも当月になる）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    // 2026-07-01 00:30 JST = 2026-06-30 15:30 UTC
    const jstMonthStart = new Date('2026-06-30T15:30:00Z')

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, { at: jstMonthStart })

    expect(outcome.targetYearMonth).toBe('2026-07')
    expect(
      await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(VIEWER_ID, TARGET_MONTH),
    ).not.toBeNull()
    expect(
      await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(
        VIEWER_ID,
        '2026-06' as YearMonth,
      ),
    ).toBeNull()
  })

  it('冪等: 再実行しても当該月のサイクルは増えず、開始イベントも再発行されない', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const log = collectStarted(t)

    const first = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })
    const second = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: new Date('2026-07-01T00:05:00+09:00'),
    })

    expect(resultOf(second, 'honey')?.status).toBe('already_started')
    expect(resultOf(second, 'darling')?.status).toBe('already_started')
    // 同じサイクルが返る（作り直されていない）
    expect(second.results).toEqual(
      first.results.map(r => ({ ...r, status: 'already_started' as const })),
    )
    // 再実行ぶんの発行は無い（1 回目の 2 件だけ）
    expect(log).toHaveLength(2)
  })

  it('月の途中で再実行しても、積み上がった当月経費が空サイクルで消されない', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    await t.deps.monthlyExpenseCycleRepository.save(
      cycleWithAccumulation(VIEWER_ID, '01CYC000000000000000000001'),
    )
    const log = collectStarted(t)

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: new Date('2026-07-20T00:00:00+09:00'),
    })

    expect(resultOf(outcome, 'honey')?.status).toBe('already_started')
    const kept = await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(
      VIEWER_ID,
      TARGET_MONTH,
    )
    expect(kept?.common.monthlyExpenseCycleId).toBe('01CYC000000000000000000001')
    expect(kept?.common.accumulations[0]?.currentTotal).toBe(8000)
    expect(kept?.common.cycleStartedAt).toEqual(AT)
    // 開始済みの側にイベントは出ない（darling の 1 件のみ）
    expect(log.map(e => e.userId)).toEqual([SPOUSE_ID])
  })

  it('CSV 確定済みの月に再実行しても、状態が集積中へ巻き戻らない', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const confirmed = MonthlyExpenseCycleSchema.parse({
      ...cycleWithAccumulation(VIEWER_ID, '01CYC000000000000000000002'),
      kind: 'csv_confirmed',
      csvConfirmedAt: new Date('2026-07-10T00:00:00+09:00'),
    })
    await t.deps.monthlyExpenseCycleRepository.save(confirmed)

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: new Date('2026-07-20T00:00:00+09:00'),
    })

    expect(resultOf(outcome, 'honey')?.status).toBe('already_started')
    const kept = await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(
      VIEWER_ID,
      TARGET_MONTH,
    )
    expect(kept?.kind).toBe('csv_confirmed')
    expect(kept?.common.accumulations[0]?.currentTotal).toBe(8000)
  })

  it('手動開始済みの月は自動開始が二重に作らない（手動・自動の混在でも 1 つ）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const log = collectStarted(t)
    await startMonthlyExpenseCycleForUser(t.deps, {
      userId: VIEWER_ID,
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })

    expect(resultOf(outcome, 'honey')?.status).toBe('already_started')
    expect(resultOf(outcome, 'darling')?.status).toBe('started')
    expect(log).toHaveLength(2)
  })

  it('同時起動で保存が一意違反になっても、失敗ではなく開始済みとして扱う', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // 存在確認の直後に別経路が同じ月を作った状況（1 回目の findByUserAndMonth だけ null を返す）
    const repository = t.deps.monthlyExpenseCycleRepository
    const realFind = repository.findByUserAndMonth.bind(repository)
    vi.spyOn(repository, 'findByUserAndMonth').mockImplementationOnce(async () => {
      await repository.save(cycleWithAccumulation(VIEWER_ID, '01CYC000000000000000000003'))
      return null
    })

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })

    expect(resultOf(outcome, 'honey')?.status).toBe('already_started')
    expect(resultOf(outcome, 'darling')?.status).toBe('started')
    // 先に作られたサイクルが残り、後着に上書きされない
    const kept = await realFind(VIEWER_ID, TARGET_MONTH)
    expect(kept?.common.monthlyExpenseCycleId).toBe('01CYC000000000000000000003')
    expect(kept?.common.accumulations[0]?.currentTotal).toBe(8000)
    // 通報対象ではない（失敗としてログに出さない）
    expect(consoleError).not.toHaveBeenCalled()

    vi.restoreAllMocks()
  })

  it('一方の保存に失敗しても、もう一方の開始は巻き込まれない', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const log = collectStarted(t)
    const save = vi
      .spyOn(t.deps.monthlyExpenseCycleRepository, 'save')
      .mockRejectedValueOnce(new Error('DB 接続断'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })

    // 保存前に落ちたので、再実行で開始をやり直せる
    expect(resultOf(outcome, 'honey')).toMatchObject({
      status: 'failed',
      failureKind: 'Error',
      stage: 'not_started',
    })
    expect(resultOf(outcome, 'darling')?.status).toBe('started')
    // 失敗した側のサイクルは残らず、成功した側は残る
    expect(
      await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(VIEWER_ID, TARGET_MONTH),
    ).toBeNull()
    expect(
      await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(SPOUSE_ID, TARGET_MONTH),
    ).not.toBeNull()
    // 失敗した側の開始イベントは出ない（成功した 1 件のみ）
    expect(log.map(e => e.userId)).toEqual([SPOUSE_ID])
    // 握りつぶさず記録する。ただしユーザーID（LINE userID）はログに出さない
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(String(consoleError.mock.calls[0]?.[0])).not.toContain(VIEWER_ID)

    save.mockRestore()
    consoleError.mockRestore()
  })

  it('保存後にイベント発行が失敗した回は、サイクルが残ったまま失敗として記録される（再実行では発行が回復しない）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    const publish = vi
      .spyOn(t.deps.eventBus, 'publish')
      .mockRejectedValueOnce(new Error('イベント配信失敗'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })

    // 保存は済んでいるため、再実行では回復しない失敗として区別される
    expect(resultOf(outcome, 'honey')).toMatchObject({
      status: 'failed',
      stage: 'event_publish',
    })
    expect(resultOf(outcome, 'darling')?.status).toBe('started')
    const saved = await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(
      VIEWER_ID,
      TARGET_MONTH,
    )
    expect(saved).not.toBeNull()
    expect(consoleError).toHaveBeenCalledTimes(1)

    publish.mockRestore()
    // 再実行しても already_started になり、取りこぼした開始イベントは出ない（既知の制約）
    const log = collectStarted(t)
    const retry = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })
    expect(resultOf(retry, 'honey')?.status).toBe('already_started')
    expect(log).toHaveLength(0)

    consoleError.mockRestore()
  })

  it('未登録の役割は開始対象にせず、登録済みの役割だけを開始する', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    const log = collectStarted(t)

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })

    expect(resultOf(outcome, 'honey')?.status).toBe('started')
    expect(resultOf(outcome, 'darling')?.status).toBe('not_registered')
    expect(log).toHaveLength(1)
  })

  it('対象年月ごとに別のサイクルが作られる（前月開始済みでも当月は開始する）', async () => {
    const t = createTestApp()
    await registerHousehold(t)
    await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: '2026-06' as YearMonth,
      at: new Date('2026-06-01T00:00:00+09:00'),
    })

    const outcome = await startMonthlyExpenseCyclesForHousehold(t.deps, {
      targetYearMonth: TARGET_MONTH,
      at: AT,
    })

    expect(resultOf(outcome, 'honey')?.status).toBe('started')
    const june = await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(
      VIEWER_ID,
      '2026-06' as YearMonth,
    )
    const july = await t.deps.monthlyExpenseCycleRepository.findByUserAndMonth(
      VIEWER_ID,
      TARGET_MONTH,
    )
    expect(june?.common.monthlyExpenseCycleId).not.toBe(july?.common.monthlyExpenseCycleId)
  })
})

describe('ユーザー単位の開始（手動開始と共通の適用経路）', () => {
  it('保存の失敗は呼出し元へ伝播する（黙って成功にしない）', async () => {
    const t = createTestApp()
    const save = vi
      .spyOn(t.deps.monthlyExpenseCycleRepository, 'save')
      .mockRejectedValueOnce(new Error('DB 接続断'))

    await expect(
      startMonthlyExpenseCycleForUser(t.deps, {
        userId: VIEWER_ID,
        targetYearMonth: TARGET_MONTH,
        at: AT,
      }),
    ).rejects.toThrow('DB 接続断')

    save.mockRestore()
  })
})
