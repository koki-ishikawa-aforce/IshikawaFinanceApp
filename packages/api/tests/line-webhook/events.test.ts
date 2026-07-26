/**
 * LINE Webhook ACL（腐敗防止層）の単体テスト
 *
 * 翻訳層は LINE 側の payload 変化を最初に受け止める箇所なので、
 * 「意図に翻訳される条件 / されない条件」を単体で固定しておく。
 */
import { describe, it, expect } from 'vitest'
import { LineWebhookRequestSchema, toLineWebhookIntents } from '../../src/line-webhook/events.js'

function intentsOf(body: unknown): ReturnType<typeof toLineWebhookIntents> {
  return toLineWebhookIntents(LineWebhookRequestSchema.parse(body))
}

describe('LineWebhookRequestSchema', () => {
  it('events を持たないボディは受理しない（Webhook のリクエスト形ではない）', () => {
    expect(() => LineWebhookRequestSchema.parse({ destination: 'U0001' })).toThrow()
  })

  it('未知のイベント種別・未知のフィールドが混ざっても受理する（LINE 側の追加に追従する）', () => {
    expect(() =>
      LineWebhookRequestSchema.parse({
        destination: 'U0001',
        events: [{ type: 'videoPlayComplete', unknownField: { nested: true } }],
      }),
    ).not.toThrow()
  })
})

describe('toLineWebhookIntents — follow', () => {
  it('source.userId のある follow を友達追加の意図に翻訳する', () => {
    const intents = intentsOf({
      events: [{ type: 'follow', source: { type: 'user', userId: 'U0001' } }],
    })
    expect(intents).toEqual([{ kind: 'friend_added', userId: 'U0001' }])
  })

  it('userId を欠く follow は意図にしない', () => {
    expect(intentsOf({ events: [{ type: 'follow', source: { type: 'user' } }] })).toEqual([])
  })

  it('source そのものを欠く follow は意図にしない', () => {
    expect(intentsOf({ events: [{ type: 'follow' }] })).toEqual([])
  })

  it('userId が空文字の follow は意図にしない', () => {
    expect(
      intentsOf({ events: [{ type: 'follow', source: { type: 'user', userId: '' } }] }),
    ).toEqual([])
  })
})

describe('toLineWebhookIntents — join', () => {
  it('グループ（source.type = group）の join を groupId から翻訳する', () => {
    const intents = intentsOf({
      events: [{ type: 'join', source: { type: 'group', groupId: 'C0001' } }],
    })
    expect(intents).toEqual([
      { kind: 'talk_room_joined', talkRoomKind: 'group', talkRoomId: 'C0001' },
    ])
  })

  it('複数人トーク（source.type = room）の join を roomId から翻訳する', () => {
    const intents = intentsOf({
      events: [{ type: 'join', source: { type: 'room', roomId: 'R0001' } }],
    })
    // 種別は在籍照会のエンドポイント選択に使う（#371）。ID だけでは判別できない
    expect(intents).toEqual([
      { kind: 'talk_room_joined', talkRoomKind: 'room', talkRoomId: 'R0001' },
    ])
  })

  it('ID フィールドが source.type と食い違う join は意図にしない', () => {
    // group なのに groupId ではなく roomId が入っている（LINE の仕様変更・偽装）
    expect(
      intentsOf({ events: [{ type: 'join', source: { type: 'group', roomId: 'R0001' } }] }),
    ).toEqual([])
  })

  it('source.type が user の join は意図にしない（トークルームではない）', () => {
    expect(
      intentsOf({ events: [{ type: 'join', source: { type: 'user', userId: 'U0001' } }] }),
    ).toEqual([])
  })
})

describe('toLineWebhookIntents — 対象外と混在', () => {
  it('follow / join 以外のイベント種別は意図にしない', () => {
    const intents = intentsOf({
      events: [
        { type: 'message', source: { type: 'user', userId: 'U0001' } },
        { type: 'unfollow', source: { type: 'user', userId: 'U0001' } },
        { type: 'leave', source: { type: 'group', groupId: 'C0001' } },
        { type: 'postback', source: { type: 'user', userId: 'U0001' } },
      ],
    })
    expect(intents).toEqual([])
  })

  it('形が想定外のイベントは読み飛ばし、同じバッチの正常なイベントは翻訳する', () => {
    // type を欠く / 配列や文字列が混ざっても、バッチ全体を落とさない
    const intents = intentsOf({
      events: [
        { source: { type: 'user', userId: 'U0001' } },
        'not-an-object',
        null,
        { type: 'follow', source: { type: 'user', userId: 'U0002' } },
      ],
    })
    expect(intents).toEqual([{ kind: 'friend_added', userId: 'U0002' }])
  })

  it('1 リクエストに複数の意図が含まれる場合は受信順に並べる', () => {
    const intents = intentsOf({
      events: [
        { type: 'join', source: { type: 'group', groupId: 'C0001' } },
        { type: 'follow', source: { type: 'user', userId: 'U0001' } },
      ],
    })
    expect(intents).toEqual([
      { kind: 'talk_room_joined', talkRoomKind: 'group', talkRoomId: 'C0001' },
      { kind: 'friend_added', userId: 'U0001' },
    ])
  })

  it('events が空なら意図は無い（LINE Developers の検証ボタン）', () => {
    expect(intentsOf({ events: [] })).toEqual([])
  })
})
