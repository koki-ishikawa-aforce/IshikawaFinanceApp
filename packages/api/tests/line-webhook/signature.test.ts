import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyLineSignature } from '../../src/line-webhook/signature.js'

const SECRET = 'channel-secret-for-test'

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

function bytes(body: string): Uint8Array {
  return new TextEncoder().encode(body)
}

describe('verifyLineSignature', () => {
  const body = '{"destination":"Uabc","events":[]}'

  it('Channel Secret で計算した署名を受理する', () => {
    expect(verifyLineSignature(bytes(body), sign(body), SECRET)).toBe(true)
  })

  it('本文が 1 文字でも書き換えられた署名を拒否する', () => {
    const tampered = '{"destination":"Uabd","events":[]}'
    expect(verifyLineSignature(bytes(tampered), sign(body), SECRET)).toBe(false)
  })

  it('別の Channel Secret で計算された署名を拒否する', () => {
    expect(verifyLineSignature(bytes(body), sign(body, 'other-secret'), SECRET)).toBe(false)
  })

  it('Base64 として不正な署名を例外にせず拒否する', () => {
    expect(verifyLineSignature(bytes(body), 'not-a-valid-signature!!', SECRET)).toBe(false)
  })

  it('長さの異なる署名を例外にせず拒否する（timingSafeEqual は長さ不一致で throw する）', () => {
    const truncated = sign(body).slice(0, 10)
    expect(verifyLineSignature(bytes(body), truncated, SECRET)).toBe(false)
  })

  it('空の署名を拒否する', () => {
    expect(verifyLineSignature(bytes(body), '', SECRET)).toBe(false)
  })

  it('空の Channel Secret では常に拒否する（鍵未設定を素通しにしない）', () => {
    expect(verifyLineSignature(bytes(body), sign(body, ''), '')).toBe(false)
  })

  it('マルチバイト文字を含む本文でも一致する（生バイト列で計算する）', () => {
    const japanese = '{"events":[],"note":"共通トークルーム"}'
    expect(verifyLineSignature(bytes(japanese), sign(japanese), SECRET)).toBe(true)
  })
})
