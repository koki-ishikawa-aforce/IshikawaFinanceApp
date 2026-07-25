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
 * 記録・保存・イベント発行は `line-operation-records.ts` に一本化しており、状態が
 * 変わったときだけ保存・発行することで二重記録・二重発行を防ぐ。
 *
 * ログ: LINE userID・共通トークルームIDは個人を辿れる識別子のため出力しない。
 */
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppUserRepository, EventBus, SharedTalkRoomRepository } from '@warimaru/domain'
import type { TalkRoomId, UserId } from '@warimaru/domain'
import { readJsonObjectBody } from '../read-json-object-body.js'
import { LineWebhookRequestSchema, toLineWebhookIntents } from '../line-webhook/events.js'
import { verifyLineSignature } from '../line-webhook/signature.js'
import { applyLineFriendAdded, applySharedTalkRoomJoined } from '../line-operation-records.js'

/**
 * 受理する本文の上限。ルートが認証の外にある以上、署名検証には生バイト列が必要で、
 * 読み込みは検証より前に起きる。上限が無いと、署名を持たない相手でも巨大な本文を
 * 送りつけてメモリを圧迫できる（api は前段のリバースプロキシ無しで待ち受けている）。
 * LINE の Webhook 本文は 1 リクエストあたり数十 KB 程度に収まるため、余裕を見て 1 MiB。
 */
const MAX_BODY_BYTES = 1024 * 1024

export interface LineWebhookRoutesDeps {
  appUserRepository: AppUserRepository
  sharedTalkRoomRepository: SharedTalkRoomRepository
  /** 署名検証鍵の解決（OQ-55 ④: 開発環境の環境変数、または Phase0Config の保管参照 → Parameter Store 復号） */
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
  await applyLineFriendAdded(deps, user, receivedAt)
}

/**
 * join: 世帯レベルの共通トークルーム参加を記録する（OQ-55 ①）
 *
 * `join` の source は userId を含まないため、届いたトークルームが**この世帯のものか**は
 * イベント単体からは判定できない。署名検証が保証するのは「LINE から来た」ことだけで、
 * 公式アカウントを自分のグループへ招待できる第三者も正規の `join` を発生させられる。
 * 共通トークルームは家計サマリの配信先（`DeliveryTarget.shared_talk_room`）そのものなので、
 * 無条件に上書きすると配信先を差し替えられる。
 *
 * そのため Webhook 由来の記録は**まだ参加記録が無いときだけ**受け付け、既存の記録は
 * 上書きしない。参加先の変更（招待し直し）は LIFF 認証を通る自己申告 API
 * （`POST /api/onboarding/phase1/talk-room`）に残す。
 * 未参加状態での取り違え（初回登録の取り合い）を防ぐ在籍確認（Messaging API の照会）は
 * 外部連携の追加を伴う判断のため、#371 に切り出して判断を仰いでいる。
 */
async function handleTalkRoomJoined(
  deps: LineWebhookRoutesDeps,
  talkRoomId: TalkRoomId,
  receivedAt: Date,
): Promise<void> {
  const current = await deps.sharedTalkRoomRepository.find()
  if (current.kind === 'joined') {
    if (current.talkRoomId !== talkRoomId) {
      console.warn(
        'LINE Webhook: 既に参加記録があるため、別トークルームの join を記録しない（配信先の差し替えを防ぐ）',
      )
    }
    return
  }
  await applySharedTalkRoomJoined(deps, current, talkRoomId, receivedAt)
}

export function lineWebhookRoutes(deps: LineWebhookRoutesDeps): Hono {
  const app = new Hono()

  // 既定の onError は HTTPException を throw し、app.onError（errorHandler）が
  // 未マップの例外として 500 に落としてしまうため、413 をここで直接返す
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: c => c.json({ error: 'Payload too large' }, 413),
  })

  app.post('/line', limit, async c => {
    // 署名は受信した生バイト列に対して検証する（再直列化した JSON では一致しない）
    const rawBody = new Uint8Array(await c.req.arrayBuffer())
    const signature = c.req.header('x-line-signature')

    let channelSecret: string
    try {
      channelSecret = await deps.resolveLineChannelSecret()
    } catch (err) {
      // 鍵を解決できない = 署名を検証できない。真正性を確かめられないまま受理しない。
      // 500 を返すことで LINE 側の再送に委ね、構成修復後に取りこぼしを回収する。
      // 例外オブジェクトを丸ごと出すと Parameter Store のパス等が落ちるため、種別だけ残す
      console.error(
        'LINE Webhook: Channel Secret を解決できないため署名検証を実施できない',
        err instanceof Error ? err.name : 'unknown',
      )
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
