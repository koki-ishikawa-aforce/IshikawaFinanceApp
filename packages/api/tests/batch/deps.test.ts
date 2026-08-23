/**
 * バッチ用の依存合成（#416）のテスト。
 *
 * ここが壊れても本番でしか露見しない振る舞いが 3 つある:
 *  - 定時起動がモック合成（空のデータ）で走らないこと
 *  - API と同じイベント購読が張られること（張り忘れるとバッチ経路でだけ後続が動かない）
 *  - 実行環境を使い回すあいだ 1 度だけ組み立て、失敗した回は次の起動でやり直せること
 *
 * 実 DB は要らない。DB クライアントは接続を張らずに組み立てられる
 * （`tests/composition-root.test.ts` の実 deps 構築と同じ前提）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { MonthlyLimitCreatedSchema } from '@warimaru/domain'
import { createBatchDeps, loadBatchDeps, loadLocalBatchDeps } from '../../src/batch/deps.js'
import { createDeps } from '../../src/composition-root.js'
import { VIEWER_ID } from '../helpers/test-app.js'

const FAKE_DB_URL = 'postgresql://user:pass@localhost:5432/warimaru'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** 月次上限の新規設定 → 当月按分の再計算（#140）。購読が無ければ誰も反応しない */
function monthlyLimitCreated() {
  return MonthlyLimitCreatedSchema.parse({
    eventId: '01M0N0S7CW108E4Z44YD9PCFZS',
    occurredAt: new Date('2026-08-01T00:00:00Z'),
    type: 'MonthlyLimitCreated',
    monthlyLimitId: '01MNT000000000000000000001',
    userId: VIEWER_ID,
    expenseTypeId: '01EXP000000000000000000001',
    seedLimit: { kind: 'unlimited' },
  })
}

describe('createBatchDeps', () => {
  it('定時起動は DATABASE_URL が無ければ合成せずに失敗する（空のモックで「成功」させない）', async () => {
    await expect(createBatchDeps({})).rejects.toThrow(/DATABASE_URL is required/)
  })

  it('手動起動はモック合成を明示的に許す', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(createBatchDeps({}, { allowMockFallback: true })).resolves.toHaveProperty(
      'appUserRepository',
    )
  })

  it('API と同じイベント購読が張られる（バッチが出したイベントも後続処理を通る）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = await createBatchDeps({}, { allowMockFallback: true })
    const recalc = vi.spyOn(deps.monthlyExpenseCycleRepository, 'findByUserAndMonth')

    await deps.eventBus.publish(monthlyLimitCreated())

    expect(recalc).toHaveBeenCalled()
  })

  it('合成しただけの依存には購読が張られない（上のテストが購読の有無を見ていることの確認）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = await createDeps({})
    const recalc = vi.spyOn(deps.monthlyExpenseCycleRepository, 'findByUserAndMonth')

    await deps.eventBus.publish(monthlyLimitCreated())

    expect(recalc).not.toHaveBeenCalled()
  })
})

describe('loadBatchDeps', () => {
  it('合成に失敗した回はキャッシュせず、設定を直せば次の起動で回復する', async () => {
    vi.stubEnv('DATABASE_URL', '')
    await expect(loadBatchDeps()).rejects.toThrow(/DATABASE_URL is required/)

    vi.stubEnv('DATABASE_URL', FAKE_DB_URL)
    await expect(loadBatchDeps()).resolves.toBeDefined()
  })

  it('実行環境を使い回すあいだは 1 度だけ組み立てる', async () => {
    vi.stubEnv('DATABASE_URL', FAKE_DB_URL)

    expect(await loadBatchDeps()).toBe(await loadBatchDeps())
  })
})

describe('loadLocalBatchDeps', () => {
  it('DATABASE_URL が無くてもモック合成で組み立てる', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('DATABASE_URL', '')

    await expect(loadLocalBatchDeps()).resolves.toHaveProperty('appUserRepository')
  })
})
