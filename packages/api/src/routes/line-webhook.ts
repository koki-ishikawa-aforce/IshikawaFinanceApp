/**
 * LINE Webhook 受信（#296 / #73 B 段）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2「follow Webhook を受信する」「join Webhook を受信する」
 * @see docs/domain/03-open-questions.md OQ-55 ③ ④
 *
 * OQ-55 ④: LINE プラットフォームから到達するため、このルートは LIFF 認証（`/api/*`
 * ミドルウェア）の外（`/webhook/line`）にマウントする。送信元の真正性は
 * `x-line-signature` の HMAC-SHA256 署名検証だけが担保するため、署名を検証できない
 * リクエストは本文の解釈すら行わない（fail-closed）。
 *
 * 受信するイベント:
 *  - `follow`（友だち追加） → 友達追加済みの記録 + `LineFriendAdded`。
 *    OQ-55 ③: 宛先の AppUser が未登録なら処理せずログのみ残す（登録完了時の
 *    友だち状態照会で拾い直す。実装は C 段 #297）
 *  - `join`（共通トークルーム参加） → 世帯レベルの `SharedTalkRoom` へ記録 +
 *    `LineTalkRoomJoined`（OQ-55 ①: 参加は世帯にひとつの事実）
 *
 * 冪等性: LINE Webhook は at-least-once であり、同一イベントが再送されうる。
 * `recordLineFriendAdded` / `recordSharedTalkRoomJoined` はいずれも状態が変わらない
 * ときに元の値をそのまま返すため、その参照比較で「変化したときだけ保存・発行する」
 * ことで二重記録・二重発行を防ぐ。
 *
 * ログ: LINE userID・共通トークルームIDは個人を辿れる識別子のため出力しない。
 */
import { Hono } from 'hono'
import {
  LineFriendAddedSchema,
  LineTalkRoomJoinedSchema,
  recordLineFriendAdded,
  recordSharedTalkRoomJoined,
} from '@warimaru/domain'
import type {
  AppUserRepository,
  EventBus,
  SharedTalkRoomRepository,
  TalkRoomId,
  UserId,
} from '@warimaru/domain'
import { domainEventBase } from '../event-handlers/index.js'
import { readJsonObjectBody } from '../read-json-object-body.js'
import { LineWebhookRequestSchema, toLineWebhookIntents } from '../line-webhook/events.js'
import { verifyLineSignature } from '../line-webhook/signature.js'

export interface LineWebhookRoutesDeps {
  appUserRepository: AppUserRepository
  sharedTalkRoomRepository: SharedTalkRoomRepository
  /** 署名検証鍵の解決（OQ-55 ④: 環境変数、または Phase0Config の保管参照 → Parameter Store 復号） */
  resolveLineChannelSecret: () => Promise<string>
  eventBus: EventBus
}

/** follow: 友だち追加を記録する。未登録ユーザー宛ては記録せず握りつぶす（OQ-55 ③） */
async function handleFriendAdded(
  deps: LineWebhookRoutesDeps,
  userId: UserId,
  receivedAt: Date,
): Promise<void> {
  const user = await deps.appUserRepository.findById(userId)
  if (user === null) {
    console.info('LINE Webhook: 未登録ユーザーの follow を受信したため記録しない（OQ-55 ③）')
    return
  }
  const updated = recordLineFriendAdded(user, receivedAt)
  if (updated === user) return
  await deps.appUserRepository.save(updated)
  await deps.eventBus.publish(
    LineFriendAddedSchema.parse({
      ...domainEventBase(receivedAt),
      type: 'LineFriendAdded',
      userId,
      receivedAt,
    }),
  )
}

/** join: 世帯レベルの共通トークルーム参加を記録する（OQ-55 ①） */
async function handleTalkRoomJoined(
  deps: LineWebhookRoutesDeps,
  talkRoomId: TalkRoomId,
  receivedAt: Date,
): Promise<void> {
  const current = await deps.sharedTalkRoomRepository.find()
  const updated = recordSharedTalkRoomJoined(current, talkRoomId, receivedAt)
  if (updated === current) return
  await deps.sharedTalkRoomRepository.save(updated)
  await deps.eventBus.publish(
    LineTalkRoomJoinedSchema.parse({
      ...domainEventBase(receivedAt),
      type: 'LineTalkRoomJoined',
      talkRoomId,
      receivedAt,
    }),
  )
}

export function lineWebhookRoutes(deps: LineWebhookRoutesDeps): Hono {
  const app = new Hono()

  app.post('/line', async c => {
    // 署名は受信した生バイト列に対して検証する（再直列化した JSON では一致しない）
    const rawBody = new Uint8Array(await c.req.arrayBuffer())
    const signature = c.req.header('x-line-signature')

    let channelSecret: string
    try {
      channelSecret = await deps.resolveLineChannelSecret()
    } catch (err) {
      // 鍵を解決できない = 署名を検証できない。真正性を確かめられないまま受理しない。
      // 500 を返すことで LINE 側の再送に委ね、構成修復後に取りこぼしを回収する
      console.error('LINE Webhook: Channel Secret を解決できないため署名検証を実施できない', err)
      return c.json({ error: 'LINE webhook is not configured' }, 500)
    }

    if (signature === undefined || !verifyLineSignature(rawBody, signature, channelSecret)) {
      console.warn('LINE Webhook: 署名検証に失敗したリクエストを拒否した')
      return c.json({ error: 'Invalid signature' }, 401)
    }

    const request = LineWebhookRequestSchema.parse(
      readJsonObjectBody(new TextDecoder().decode(rawBody)),
    )
    const receivedAt = new Date()
    for (const intent of toLineWebhookIntents(request)) {
      if (intent.kind === 'friend_added') {
        await handleFriendAdded(deps, intent.userId, receivedAt)
      } else {
        await handleTalkRoomJoined(deps, intent.talkRoomId, receivedAt)
      }
    }

    return c.json({ ok: true })
  })

  return app
}
