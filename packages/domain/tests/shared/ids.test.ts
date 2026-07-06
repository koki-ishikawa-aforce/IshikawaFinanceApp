import { describe, it, expect } from 'vitest'
import {
  TransactionIdSchema,
  DeliveryLogIdSchema,
  UserIdSchema,
  TalkRoomIdSchema,
  GmailMessageIdSchema,
} from '../../src/shared/ids'

describe('branded ID（OQ-41: ULID 強化）', () => {
  describe('内部発番 ID は ULID 形式のみ受理する', () => {
    it('正しい ULID は parse 成功', () => {
      expect(() => TransactionIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')).not.toThrow()
      expect(() => DeliveryLogIdSchema.parse('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).not.toThrow()
    })

    it('旧形式の任意文字列は parse 失敗', () => {
      expect(() => TransactionIdSchema.parse('tx_001')).toThrow()
    })

    it('25 文字 / 27 文字は parse 失敗', () => {
      expect(() => TransactionIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FA')).toThrow()
      expect(() => TransactionIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FAVX')).toThrow()
    })

    it('先頭桁 8 以上（128bit 範囲外）は parse 失敗', () => {
      expect(() => TransactionIdSchema.parse('8ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toThrow()
    })

    it('Crockford Base32 除外文字（I / L / O / U）を含むと parse 失敗', () => {
      expect(() => TransactionIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toThrow()
      expect(() => TransactionIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FAL')).toThrow()
      expect(() => TransactionIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FAO')).toThrow()
      expect(() => TransactionIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FAU')).toThrow()
    })

    it('小文字は parse 失敗', () => {
      expect(() => TransactionIdSchema.parse('01arz3ndektsv4rrffq69g5fav')).toThrow()
    })
  })

  describe('外部由来 ID は min(1) を維持する（形式は発行元依存）', () => {
    it('LINE userID / トークルーム ID / Gmail message ID 形式を受理する', () => {
      expect(() => UserIdSchema.parse('U4af4980629abcdef1234567890abcdef')).not.toThrow()
      expect(() => TalkRoomIdSchema.parse('C1234567890abcdef1234567890abcdef')).not.toThrow()
      expect(() => GmailMessageIdSchema.parse('18c2f4a9b3d1e5f7')).not.toThrow()
    })

    it('空文字は parse 失敗', () => {
      expect(() => UserIdSchema.parse('')).toThrow()
      expect(() => TalkRoomIdSchema.parse('')).toThrow()
    })
  })
})
