/**
 * 移行前 payload（通知機能有効化記録に共通トークルームID を含む）の扱い（#334 / OQ-55 ①）
 *
 * 0009 のデータ移行 DML と、移行前の行をそのまま読んだ場合の両方を検証する。
 * インメモリ実装では既存行の形を再現できないため、実 PostgreSQL でのみ検出できる。
 *
 * 移行 SQL は複製せずマイグレーションファイルを読んで流す（複製すると本体を直したときに
 * テストが緑のまま乖離する）。
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { db } from './setup'
import { NeonAppUserRepository } from '../../src/onboarding-auth/NeonAppUserRepository'
import { appUsers } from '../../src/schema'
import { operationStartedUser, phase2CompletedUser } from '../helpers/onboardingFixtures'
import { HONEY_USER_ID } from '../helpers/fixtures'

const repo = new NeonAppUserRepository(db)

const ACTIVATED_AT = '2026-06-17T00:00:00.000Z'
const LEGACY_TALK_ROOM_ID = 'C0000000000000000000000000000009'
const MIGRATION_URL = new URL(
  '../../drizzle/0009_strip_activation_talk_room_id.sql',
  import.meta.url,
)

/** 0009 のデータ移行 DML をファイルからそのまま実行する */
const stripActivationTalkRoomId = async () =>
  db.execute(sql.raw(await readFile(MIGRATION_URL, 'utf8')))

/** 保存済みの行の payload の指定パスに JSON 値を書き込む */
const setPayloadAt = (path: string, value: unknown) =>
  db.execute(
    sql`UPDATE "app_users" SET "payload" = jsonb_set("payload", ${path}::text[], ${JSON.stringify(value)}::jsonb)`,
  )

const injectLegacyTalkRoomId = () =>
  setPayloadAt('{lineOperationSettings,notificationActivation,talkRoomId}', LEGACY_TALK_ROOM_ID)

const payloadOf = async (): Promise<Record<string, unknown>> => {
  const rows = await db.select({ payload: appUsers.payload }).from(appUsers).limit(1)
  const row = rows[0]
  if (row === undefined) throw new Error('app_users に行が無い')
  return row.payload as Record<string, unknown>
}

const activationOf = (payload: Record<string, unknown>): Record<string, unknown> =>
  (payload.lineOperationSettings as { notificationActivation: Record<string, unknown> })
    .notificationActivation

/** 運用開始前ユーザーの common 配下へ LINE 運用設定を注入する（AppUser の昇格規約） */
const injectCommonSettings = (notificationActivation: Record<string, unknown>) =>
  setPayloadAt('{common,lineOperationSettings}', {
    friendAdd: { kind: 'added', followWebhookReceivedAt: '2026-06-15T00:00:00.000Z' },
    notificationActivation,
  })

const commonActivationOf = (payload: Record<string, unknown>): Record<string, unknown> =>
  (
    payload.common as {
      lineOperationSettings: { notificationActivation: Record<string, unknown> }
    }
  ).lineOperationSettings.notificationActivation

describe('通知機能有効化記録からの共通トークルームID 除去（#334）', () => {
  it('運用開始済みユーザー（集約直下）の talkRoomId が移行で除かれ、有効化日時は残る', async () => {
    await repo.save(operationStartedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await injectLegacyTalkRoomId()

    await stripActivationTalkRoomId()

    expect(activationOf(await payloadOf())).toEqual({
      kind: 'activated',
      activatedAt: ACTIVATED_AT,
    })
  })

  it('運用開始前ユーザー（common 配下）の talkRoomId も同じ移行で除かれる', async () => {
    await repo.save(phase2CompletedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await injectCommonSettings({
      kind: 'activated',
      talkRoomId: LEGACY_TALK_ROOM_ID,
      activatedAt: ACTIVATED_AT,
    })

    await stripActivationTalkRoomId()

    expect(commonActivationOf(await payloadOf())).toEqual({
      kind: 'activated',
      activatedAt: ACTIVATED_AT,
    })
  })

  it('未有効化の行は移行で変わらない', async () => {
    await repo.save(phase2CompletedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await injectCommonSettings({ kind: 'not_activated' })
    const before = await payloadOf()

    await stripActivationTalkRoomId()

    expect(await payloadOf()).toEqual(before)
  })

  it('移行済みの行への再適用は何も変えない（二重適用の保険）', async () => {
    await repo.save(operationStartedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await injectLegacyTalkRoomId()
    await stripActivationTalkRoomId()
    const afterFirst = await payloadOf()

    await stripActivationTalkRoomId()

    expect(await payloadOf()).toEqual(afterFirst)
  })

  it('LINE 運用設定を持たない行も移行で変わらない', async () => {
    await repo.save(phase2CompletedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    const before = await payloadOf()

    await stripActivationTalkRoomId()

    expect(await payloadOf()).toEqual(before)
  })

  it('移行前の行を読んでも talkRoomId は集約に載らない（集約直下・読取り側の保険）', async () => {
    await repo.save(operationStartedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await injectLegacyTalkRoomId()

    const loaded = await repo.findById(HONEY_USER_ID)
    if (loaded?.kind !== 'operation_started') throw new Error('unreachable')
    expect(loaded.lineOperationSettings.notificationActivation).toEqual({
      kind: 'activated',
      activatedAt: new Date(ACTIVATED_AT),
    })
  })

  it('移行前の行を読んでも talkRoomId は集約に載らない（common 配下）', async () => {
    await repo.save(phase2CompletedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await injectCommonSettings({
      kind: 'activated',
      talkRoomId: LEGACY_TALK_ROOM_ID,
      activatedAt: ACTIVATED_AT,
    })

    const loaded = await repo.findById(HONEY_USER_ID)
    if (loaded?.kind !== 'phase2_completed') throw new Error('unreachable')
    expect(loaded.common.lineOperationSettings?.notificationActivation).toEqual({
      kind: 'activated',
      activatedAt: new Date(ACTIVATED_AT),
    })
  })
})
