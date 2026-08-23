/**
 * 起動口の配線（#416）のテスト。
 *
 * `handlers.test.ts` はハンドラーを組み立てて検証するが、EventBridge が実際に呼ぶのは
 * モジュールが export する定数、手動起動が呼ぶのはコマンド名 → ハンドラーの対応表で、
 * どちらも「どのジョブに繋がっているか」を取り違えても型では捕まらない。
 * ここではその対応だけを固定する（ジョブの中身は他のテストが見る）。
 *
 * 依存の合成（`deps.js`）は差し替える。定時起動側は DATABASE_URL を要求するため、
 * 実物のままでは配線の確認に DB 設定が要ることになる。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerAppUser } from '@warimaru/domain'
import { createMockDeps, type AppDeps } from '../../src/composition-root.js'
import type { ScheduledBatchHandler } from '../../src/batch/handlers.js'
import { VIEWER_ID } from '../helpers/test-app.js'

const AT = new Date('2026-08-10T00:00:00+09:00')
const EVENT = { time: '2026-08-10T00:00:00Z', detail: {} }

/** 取込対象が居ない世帯（どのジョブも失敗せずに結末だけ返る） */
function emptyHouseholdDeps(): AppDeps {
  return createMockDeps({})
}

async function householdDeps(): Promise<AppDeps> {
  const deps = createMockDeps({})
  await deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
  return deps
}

beforeEach(() => {
  vi.resetModules()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('Lambda が呼ぶ export', () => {
  it.each([
    ['dailyMailImportHandler', 'daily-mail-import'],
    ['monthlyExpenseCycleStartHandler', 'monthly-expense-cycle-start'],
    ['csvImportReminderHandler', 'csv-import-reminder'],
  ])('%s は %s を実行する', async (exportName, job) => {
    const deps = emptyHouseholdDeps()
    vi.doMock('../../src/batch/deps.js', () => ({
      loadBatchDeps: () => Promise.resolve(deps),
      loadLocalBatchDeps: () => Promise.resolve(deps),
    }))
    // export 名で引くため、モジュール全体を「名前 → ハンドラー」として見る
    const handlers = (await import('../../src/batch/handlers.js')) as unknown as Record<
      string,
      ScheduledBatchHandler | undefined
    >

    expect((await handlers[exportName]?.(EVENT))?.job).toBe(job)
  })
})

describe('手動起動のコマンド名', () => {
  it.each([
    ['daily', 'daily-mail-import'],
    ['monthly', 'monthly-expense-cycle-start'],
    ['csv-reminder', 'csv-import-reminder'],
  ])('%s は %s を実行する', async (commandName, job) => {
    const deps = emptyHouseholdDeps()
    vi.doMock('../../src/batch/deps.js', () => ({
      loadBatchDeps: () => Promise.resolve(deps),
      loadLocalBatchDeps: () => Promise.resolve(deps),
    }))
    const { createLocalHandlers } = await import('../../src/batch/cli.js')

    expect((await createLocalHandlers()[commandName]?.(EVENT))?.job).toBe(job)
  })
})

describe('手動起動の終了コード', () => {
  async function runCli(argv: string[], deps: AppDeps): Promise<number> {
    vi.doMock('../../src/batch/deps.js', () => ({
      loadBatchDeps: () => Promise.resolve(deps),
      loadLocalBatchDeps: () => Promise.resolve(deps),
    }))
    const { runBatchCli } = await import('../../src/batch/cli.js')
    return runBatchCli(argv)
  }

  it('成功したジョブは 0 を返し、結末を標準出力に書く', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(await runCli(['monthly'], emptyHouseholdDeps())).toBe(0)
    expect(log.mock.calls.flat().join(' ')).toContain('monthly-expense-cycle-start')
  })

  it('ジョブの失敗は 1 を返す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // 登録済みで Gmail 未連携 = 取込が失敗する状態
    expect(await runCli(['daily'], await householdDeps())).toBe(1)
  })

  it.each([
    { argv: [], why: 'ジョブ名なし' },
    { argv: ['unknown-job'], why: '知らないジョブ名' },
    { argv: ['daily', '--scan-days=abc'], why: '読めないさかのぼり日数' },
    { argv: ['monthly', '--target-year-month=2026/08'], why: '書式違いの対象年月' },
  ])('呼び出し方の誤り($why)は 2 を返す', async ({ argv }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await runCli(argv, emptyHouseholdDeps())).toBe(2)
  })
})
