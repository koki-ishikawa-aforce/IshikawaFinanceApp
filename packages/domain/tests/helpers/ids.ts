import { ULID_REGEX } from '../../src/shared/ids'

/**
 * テスト用 ULID フィクスチャを「プレフィックス + ゼロ埋め + サフィックス」で
 * 26 文字に構成する（例: testUlid('01TX', 1) → '01TX0000000000000000000001'）。
 *
 * 手打ちリテラルと違い、文字数ズレ（25/27 文字）や Crockford Base32 除外文字
 * （I/L/O/U）の混入をフィクスチャ定義時点で throw して検出する。
 */
export function testUlid(prefix: string, suffix: string | number = 1): string {
  const s = String(suffix)
  const padLength = 26 - prefix.length - s.length
  if (padLength < 0) {
    throw new Error(`testUlid: プレフィックス + サフィックスが 26 文字を超えています: ${prefix}${s}`)
  }
  const id = prefix + '0'.repeat(padLength) + s
  if (!ULID_REGEX.test(id)) {
    throw new Error(`testUlid: 生成された ID が ULID 形式ではありません: ${id}`)
  }
  return id
}
