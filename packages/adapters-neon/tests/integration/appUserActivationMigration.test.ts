/**
 * 移行前 payload（通知機能有効化記録に共通トークルームID を含む）の扱い（#334 / OQ-55 ①）
 *
 * 0009 のデータ移行 DML と、移行前の行をそのまま読んだ場合の両方を検証する。
 * インメモリ実装では既存行の形を再現できないため、実 PostgreSQL でのみ検出できる。
 */
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import type { UserId } from '@warimaru/domain'
import { db } from './setup'
import { NeonAppUserRepository } from '../../src/onboarding-auth/NeonAppUserRepository'
import { operationStartedUser, phase2CompletedUser } from '../helpers/onboardingFixtures'
import { HONEY_USER_ID } from '../helpers/fixtures'

const repo = new NeonAppUserRepository(db)

const ACTIVATED_AT = '2026-06-17T00:00:00.000Z'
const LEGACY_TALK_ROOM_ID = 'C0000000000000000000000000000009'

/** 0009 のデータ移行 DML（マイグレーションファイルと同一の式） */
const stripActivationTalkRoomId = () =>
  db.execute(sql`
    UPDATE "app_users"
    SET "payload" = ("payload" #- '{lineOperationSettings,notificationActivation,talkRoomId}')
      #- '{common,lineOperationSettings,notificationActivation,talkRoomId}'
  `)

/** 保存済みの行の payload に、移行前の talkRoomId を書き戻す */
const injectLegacyTalkRoomId = (path: string) =>
  db.execute(
    sql`UPDATE "app_users" SET "payload" = jsonb_set("payload", ${path}::text[], ${JSON.stringify(LEGACY_TALK_ROOM_ID)}::jsonb)`,
  )

const payloadOf = async (): Promise<Record<string, unknown>> => {
  const result = await db.execute(sql`SELECT "payload" FROM "app_users" LIMIT 1`)
  const rows = (result as unknown as { rows: { payload: Record<string, unknown> }[] }).rows
  const row = rows[0]
  if (row === undefined) throw new Error('app_users に行が無い')
  return row.payload
}

describe('通知機能有効化記録からの共通トークルームID 除去（#334）', () => {
  it('運用開始済みユーザー（集約直下）の talkRoomId が移行で除かれ、有効化日時は残る', async () => {
    await repo.save(operationStartedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await injectLegacyTalkRoomId('{lineOperationSettings,notificationActivation,talkRoomId}')

    await stripActivationTalkRoomId()

    const activation = (
      (await payloadOf()).lineOperationSettings as {
        notificationActivation: Record<string, unknown>
      }
    ).notificationActivation
    expect(activation).not.toHaveProperty('talkRoomId')
    expect(activation).toEqual({ kind: 'activated', activatedAt: ACTIVATED_AT })
  })

  it('運用開始前ユーザー（common 配下）の talkRoomId も同じ移行で除かれる', async () => {
    // 運用開始前は LINE 運用設定を common へ事前蓄積する（AppUser の昇格規約）
    await repo.save(phase2CompletedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await db.execute(
      sql`UPDATE "app_users" SET "payload" = jsonb_set("payload", '{common,lineOperationSettings}', ${JSON.stringify(
        {
          friendAdd: { kind: 'added', followWebhookReceivedAt: '2026-06-15T00:00:00.000Z' },
          notificationActivation: {
            kind: 'activated',
            talkRoomId: LEGACY_TALK_ROOM_ID,
            activatedAt: ACTIVATED_AT,
          },
        },
      )}::jsonb)`,
    )

    await stripActivationTalkRoomId()

    const common = (await payloadOf()).common as {
      lineOperationSettings: { notificationActivation: Record<string, unknown> }
    }
    expect(common.lineOperationSettings.notificationActivation).toEqual({
      kind: 'activated',
      activatedAt: ACTIVATED_AT,
    })
  })

  it('移行を適用していない行を読んでも talkRoomId は集約に載らない（読取り側の保険）', async () => {
    await repo.save(operationStartedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await injectLegacyTalkRoomId('{lineOperationSettings,notificationActivation,talkRoomId}')

    const loaded = await repo.findById(HONEY_USER_ID as UserId)
    if (loaded?.kind !== 'operation_started') throw new Error('unreachable')
    expect(loaded.lineOperationSettings.notificationActivation).not.toHaveProperty('talkRoomId')
  })

  it('移行は有効化していないユーザーの payload を変えない', async () => {
    await repo.save(phase2CompletedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    const before = await payloadOf()

    await stripActivationTalkRoomId()

    expect(await payloadOf()).toEqual(before)
  })
})
