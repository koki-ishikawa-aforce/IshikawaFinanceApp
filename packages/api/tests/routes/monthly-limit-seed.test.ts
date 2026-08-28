import { describe, it, expect } from 'vitest'
import {
  ExpenseTypeIdSchema,
  ExpenseTypeMasterSchema,
  RoleJudgedSchema,
  UserIdSchema,
} from '@warimaru/domain'
import type {
  DefaultExpenseTypeKind,
  ExpenseTypeMaster,
  MonthlyLimitSeedInserted,
  RoleJudged,
  UserRole,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { createTestApp, type TestApp } from '../helpers/test-app.js'
import { domainEventBase } from '../../src/event-handlers/event-base.js'

/**
 * 役割確定 → 月次上限の seed 投入（#56 / 論点14 / OQ-19）
 */
const USER_ID = UserIdSchema.parse('user-honey-test')
const JUDGED_AT = new Date('2026-07-25T00:00:00.000Z')

const DEFAULT_KINDS: DefaultExpenseTypeKind[] = [
  'gym',
  'books_newspaper',
  'ai_usage',
  'transportation',
  'other_expense',
]

function makeDefaultExpenseType(defaultKind: DefaultExpenseTypeKind): ExpenseTypeMaster {
  return ExpenseTypeMasterSchema.parse({
    kind: 'default',
    expenseTypeId: ExpenseTypeIdSchema.parse(newUlid()),
    name: defaultKind,
    scope: { kind: 'household_shared' },
    defaultKind,
  })
}

/** 規定 5 種を投入し、defaultKind → expenseTypeId の対応を返す */
async function seedDefaultExpenseTypes(t: TestApp): Promise<Map<DefaultExpenseTypeKind, string>> {
  const byKind = new Map<DefaultExpenseTypeKind, string>()
  for (const defaultKind of DEFAULT_KINDS) {
    const expenseType = makeDefaultExpenseType(defaultKind)
    await t.deps.expenseTypeMasterRepository.save(expenseType)
    byKind.set(defaultKind, expenseType.expenseTypeId)
  }
  return byKind
}

function makeRoleJudged(role: UserRole): RoleJudged {
  return RoleJudgedSchema.parse({
    ...domainEventBase(),
    type: 'RoleJudged',
    lineUserId: USER_ID,
    result: { kind: 'accepted', lineUserId: USER_ID, role, judgedAt: JUDGED_AT },
  })
}

function collectSeedInserted(t: TestApp): MonthlyLimitSeedInserted[] {
  const log: MonthlyLimitSeedInserted[] = []
  t.deps.eventBus.subscribe<MonthlyLimitSeedInserted>('MonthlyLimitSeedInserted', e => {
    log.push(e)
  })
  return log
}

describe('役割確定 → 規定経費種別の月次上限 seed 投入 (#56)', () => {
  it('Honey の役割確定で規定 5 種ぶんの月次上限が OQ-19 の既定値で作られる', async () => {
    const t = createTestApp()
    const byKind = await seedDefaultExpenseTypes(t)
    const log = collectSeedInserted(t)

    await t.deps.eventBus.publish(makeRoleJudged('honey'))

    const limitOf = async (kind: DefaultExpenseTypeKind) =>
      t.deps.monthlyLimitRepository.findByUserAndExpenseType(
        USER_ID,
        ExpenseTypeIdSchema.parse(byKind.get(kind)!),
      )

    expect(await limitOf('ai_usage')).toMatchObject({ kind: 'capped', capAmount: 10000 })
    expect(await limitOf('gym')).toMatchObject({ kind: 'capped', capAmount: 5000 })
    expect(await limitOf('books_newspaper')).toMatchObject({ kind: 'capped', capAmount: 5000 })
    expect(await limitOf('transportation')).toMatchObject({ kind: 'unlimited' })
    expect(await limitOf('other_expense')).toMatchObject({ kind: 'unlimited' })

    // 適用開始は役割確定日時
    expect((await limitOf('ai_usage'))!.effectiveFrom).toEqual(JUDGED_AT)
    expect(log).toHaveLength(5)
    // 発行イベントの occurredAt は処理実行時刻ではなく役割確定日時（#658）
    expect(log.map(e => e.occurredAt)).toEqual(log.map(() => JUDGED_AT))
  })

  it('Darling の役割確定では AI 利用費が 3,000円になる（ジム・新聞図書費は共通 5,000円）', async () => {
    const t = createTestApp()
    const byKind = await seedDefaultExpenseTypes(t)

    await t.deps.eventBus.publish(makeRoleJudged('darling'))

    const ai = await t.deps.monthlyLimitRepository.findByUserAndExpenseType(
      USER_ID,
      ExpenseTypeIdSchema.parse(byKind.get('ai_usage')!),
    )
    const gym = await t.deps.monthlyLimitRepository.findByUserAndExpenseType(
      USER_ID,
      ExpenseTypeIdSchema.parse(byKind.get('gym')!),
    )

    expect(ai).toMatchObject({ kind: 'capped', capAmount: 3000 })
    expect(gym).toMatchObject({ kind: 'capped', capAmount: 5000 })
  })

  it('冪等: 同一イベントの再配信で二重作成せず、既存の上限を上書きしない', async () => {
    const t = createTestApp()
    const byKind = await seedDefaultExpenseTypes(t)
    const log = collectSeedInserted(t)
    const event = makeRoleJudged('honey')

    await t.deps.eventBus.publish(event)
    const first = await t.deps.monthlyLimitRepository.findByUserAndExpenseType(
      USER_ID,
      ExpenseTypeIdSchema.parse(byKind.get('ai_usage')!),
    )

    await t.deps.eventBus.publish(event)
    const second = await t.deps.monthlyLimitRepository.findByUserAndExpenseType(
      USER_ID,
      ExpenseTypeIdSchema.parse(byKind.get('ai_usage')!),
    )

    // 月次上限ID が変わっていない = 作り直していない
    expect(second!.monthlyLimitId).toBe(first!.monthlyLimitId)
    expect(log).toHaveLength(5)
  })

  it('役割拒否（許可リスト不一致）では月次上限を作らない', async () => {
    const t = createTestApp()
    const byKind = await seedDefaultExpenseTypes(t)
    const log = collectSeedInserted(t)

    await t.deps.eventBus.publish(
      RoleJudgedSchema.parse({
        ...domainEventBase(),
        type: 'RoleJudged',
        lineUserId: USER_ID,
        result: {
          kind: 'rejected',
          lineUserId: USER_ID,
          rejectedAt: JUDGED_AT,
          reason: 'allowlist_mismatch',
        },
      }),
    )

    expect(
      await t.deps.monthlyLimitRepository.findByUserAndExpenseType(
        USER_ID,
        ExpenseTypeIdSchema.parse(byKind.get('ai_usage')!),
      ),
    ).toBeNull()
    expect(log).toHaveLength(0)
  })

  it('追加経費種別（個人別）は seed 対象外', async () => {
    const t = createTestApp()
    await seedDefaultExpenseTypes(t)
    const custom = ExpenseTypeMasterSchema.parse({
      kind: 'custom',
      expenseTypeId: ExpenseTypeIdSchema.parse(newUlid()),
      name: '会議費',
      scope: { kind: 'personal', userId: USER_ID },
      createdAt: JUDGED_AT,
      createdByUserId: USER_ID,
      renameHistory: [],
    })
    await t.deps.expenseTypeMasterRepository.save(custom)
    const log = collectSeedInserted(t)

    await t.deps.eventBus.publish(makeRoleJudged('honey'))

    expect(
      await t.deps.monthlyLimitRepository.findByUserAndExpenseType(USER_ID, custom.expenseTypeId),
    ).toBeNull()
    expect(log).toHaveLength(5)
  })
})
