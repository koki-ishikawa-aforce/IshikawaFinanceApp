import { describe, it, expect } from 'vitest'
import { createDbConnection, resolveDbDriver } from '../../src/client'

const NEON_URL = 'postgresql://user:pass@ep-cool-block-123.ap-northeast-1.aws.neon.tech/warimaru'
const LOCAL_URL = 'postgres://postgres:postgres@localhost:5432/warimaru_test'

describe('resolveDbDriver（接続先に応じたドライバ判定、#323）', () => {
  describe('開発環境（ホストから判定する）', () => {
    it('Neon のエンドポイントなら neon-http', () => {
      expect(resolveDbDriver({ databaseUrl: NEON_URL, isProduction: false })).toBe('neon-http')
    })

    it('ローカルの素の PostgreSQL なら node-postgres', () => {
      expect(resolveDbDriver({ databaseUrl: LOCAL_URL, isProduction: false })).toBe('node-postgres')
    })

    it('ホスト名の大文字小文字は判定に影響しない', () => {
      const url = 'postgresql://user:pass@EP-COOL-BLOCK-123.AWS.NEON.TECH/warimaru'
      expect(resolveDbDriver({ databaseUrl: url, isProduction: false })).toBe('neon-http')
    })

    it('neon.tech を名前の一部に含むだけの別ホストは Neon 扱いしない', () => {
      const url = 'postgres://user:pass@neon.tech.example.com:5432/warimaru'
      expect(resolveDbDriver({ databaseUrl: url, isProduction: false })).toBe('node-postgres')
    })

    it('URL として解釈できない接続文字列は node-postgres 扱い（開発環境の指定ミスとして pg 側のエラーに委ねる）', () => {
      expect(resolveDbDriver({ databaseUrl: 'not-a-url', isProduction: false })).toBe(
        'node-postgres',
      )
    })

    it('DATABASE_DRIVER の明示指定はホスト判定より優先される', () => {
      expect(
        resolveDbDriver({
          databaseUrl: NEON_URL,
          isProduction: false,
          driverOverride: 'node-postgres',
        }),
      ).toBe('node-postgres')
      expect(
        resolveDbDriver({
          databaseUrl: LOCAL_URL,
          isProduction: false,
          driverOverride: 'neon-http',
        }),
      ).toBe('neon-http')
    })

    it('DATABASE_DRIVER の大文字小文字・前後の空白は吸収する', () => {
      expect(
        resolveDbDriver({
          databaseUrl: LOCAL_URL,
          isProduction: false,
          driverOverride: ' Neon-HTTP ',
        }),
      ).toBe('neon-http')
    })

    it('空文字・空白のみの DATABASE_DRIVER は未指定として扱う', () => {
      expect(
        resolveDbDriver({ databaseUrl: LOCAL_URL, isProduction: false, driverOverride: '  ' }),
      ).toBe('node-postgres')
    })

    it('未知の DATABASE_DRIVER は起動エラーにする（既定へ黙って倒さない）', () => {
      expect(() =>
        resolveDbDriver({ databaseUrl: LOCAL_URL, isProduction: false, driverOverride: 'sqlite' }),
      ).toThrowError(/DATABASE_DRIVER must be one of/)
    })
  })

  describe('本番環境（neon-http に固定する）', () => {
    it('接続先が Neon なら neon-http', () => {
      expect(resolveDbDriver({ databaseUrl: NEON_URL, isProduction: true })).toBe('neon-http')
    })

    it('接続先が Neon 以外でも node-postgres へ倒れない', () => {
      expect(resolveDbDriver({ databaseUrl: LOCAL_URL, isProduction: true })).toBe('neon-http')
    })

    it('DATABASE_DRIVER で node-postgres を要求されたら起動エラーにする', () => {
      expect(() =>
        resolveDbDriver({
          databaseUrl: NEON_URL,
          isProduction: true,
          driverOverride: 'node-postgres',
        }),
      ).toThrowError(/not allowed in production/)
    })

    it('DATABASE_DRIVER=neon-http は本番でも許容する（実質の再確認）', () => {
      expect(
        resolveDbDriver({ databaseUrl: NEON_URL, isProduction: true, driverOverride: 'neon-http' }),
      ).toBe('neon-http')
    })
  })
})

describe('createDbConnection の close 契約（#323）', () => {
  // seed スクリプトはこの契約に乗ってプロセスを終える。
  // neon-http は接続を保持しないため close() は何もせず resolve する（実接続なしで確認できる）。
  it('neon-http は db を返し、close() が接続なしで resolve する', async () => {
    const connection = await createDbConnection({ databaseUrl: NEON_URL, isProduction: true })

    expect(connection.db).toBeDefined()
    await expect(connection.close()).resolves.toBeUndefined()
  })
})
