/**
 * 送信認証結果（`Authentication-Results` ヘッダ）の読み取りの単体テスト（#478 段階1）
 *
 * 確かめたいのは「合格でないものを合格と読まないこと」。この読み取りは、判定を根拠にメールを
 * 弾く段階（#478 段階3）の入力になるため、`fail` や判定なしを `pass` に丸めると、認証されて
 * いないメール（三井住友カードを装った偽の利用通知）が合格として通る。
 */
import { describe, it, expect } from 'vitest'
import {
  hasAuthenticationFailure,
  parseAuthenticationResults,
} from '../../src/mail-fetch/authentication-results.js'

/** Gmail が実際に付ける形（受信サーバ名 + 方式ごとの判定 + 判定の根拠コメント） */
const GMAIL_PASS =
  'mx.google.com;\r\n       dkim=pass header.i=@vpass.ne.jp header.s=selector1 header.b=abc123;\r\n' +
  '       spf=pass (google.com: domain of statement@vpass.ne.jp designates 203.0.113.1 as permitted sender) smtp.mailfrom=statement@vpass.ne.jp;\r\n' +
  '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=vpass.ne.jp'

describe('parseAuthenticationResults', () => {
  it('Gmail が付けた合格の判定を方式ごとに読み取る', () => {
    expect(parseAuthenticationResults([GMAIL_PASS])).toEqual({
      dkim: 'pass',
      spf: 'pass',
      dmarc: 'pass',
      authServId: 'mx.google.com',
    })
  })

  it('不合格の判定を合格と取り違えない', () => {
    const header = 'mx.google.com; dkim=fail header.i=@vpass.ne.jp; spf=softfail; dmarc=fail'
    expect(parseAuthenticationResults([header])).toMatchObject({
      dkim: 'fail',
      spf: 'softfail',
      dmarc: 'fail',
    })
  })

  it('ヘッダが 1 本も無ければ全方式を判定なしとして返す（合格に丸めない）', () => {
    expect(parseAuthenticationResults([])).toEqual({
      dkim: 'absent',
      spf: 'absent',
      dmarc: 'absent',
    })
  })

  it('空文字のヘッダも判定なしとして扱う', () => {
    expect(parseAuthenticationResults(['   '])).toEqual({
      dkim: 'absent',
      spf: 'absent',
      dmarc: 'absent',
    })
  })

  it('一部の方式だけが書かれたヘッダでは、書かれていない方式を判定なしとして返す', () => {
    expect(
      parseAuthenticationResults(['mx.google.com; spf=pass smtp.mailfrom=x@vpass.ne.jp']),
    ).toEqual({ dkim: 'absent', spf: 'pass', dmarc: 'absent', authServId: 'mx.google.com' })
  })

  it('検査しなかったこと（none）を合格と読まない', () => {
    expect(
      parseAuthenticationResults(['mx.google.com; dkim=none; spf=none; dmarc=none']),
    ).toMatchObject({ dkim: 'none', spf: 'none', dmarc: 'none' })
  })

  it('既知でない判定語は unknown として残す（合格にも不合格にも寄せない）', () => {
    expect(parseAuthenticationResults(['mx.google.com; dkim=bestguesspass'])).toMatchObject({
      dkim: 'unknown',
    })
  })

  it('一時的な失敗（temperror / permperror）をそのまま残す', () => {
    expect(
      parseAuthenticationResults(['mx.google.com; dkim=temperror; spf=permperror']),
    ).toMatchObject({ dkim: 'temperror', spf: 'permperror' })
  })

  describe('偽の判定を読まない', () => {
    it('送信者が下に埋め込んだヘッダではなく、受信サーバが付けた最上位のヘッダを読む', () => {
      const forged = 'evil.example.com; dkim=pass; spf=pass; dmarc=pass'
      const received = 'mx.google.com; dkim=fail; spf=fail; dmarc=fail'
      expect(parseAuthenticationResults([received, forged])).toMatchObject({
        dkim: 'fail',
        spf: 'fail',
        dmarc: 'fail',
        authServId: 'mx.google.com',
      })
    })

    it('コメントに紛れ込ませた判定を読まない（SPF のコメントには差出人が決めた文字列が入る）', () => {
      const header =
        'mx.google.com; spf=fail (google.com: domain of "spoof dkim=pass dmarc=pass"@evil.example.com does not designate 203.0.113.9 as permitted sender)'
      expect(parseAuthenticationResults([header])).toMatchObject({
        spf: 'fail',
        dkim: 'absent',
        dmarc: 'absent',
      })
    })

    it('入れ子のコメントの中の判定も読まない', () => {
      const header = 'mx.google.com; spf=fail (a (b dkim=pass) c)'
      expect(parseAuthenticationResults([header])).toMatchObject({ spf: 'fail', dkim: 'absent' })
    })

    it('同じ方式が 2 度書かれていても、後ろの判定で上書きしない', () => {
      expect(parseAuthenticationResults(['mx.google.com; dkim=fail; dkim=pass'])).toMatchObject({
        dkim: 'fail',
      })
    })

    it('プロパティ名の一部（header.d= や x-dkim=）を方式の判定と読まない', () => {
      const header = 'mx.google.com; dkim=fail header.d=vpass.ne.jp x-dkim=pass'
      expect(parseAuthenticationResults([header])).toMatchObject({ dkim: 'fail' })
    })

    it('受信サーバ名の欄に方式名が書かれていても判定として読まない', () => {
      // authserv-id は最初の `;` より前。ここに `dkim=pass` を書かれても判定にはしない
      expect(parseAuthenticationResults(['dkim=pass'])).toEqual({
        dkim: 'absent',
        spf: 'absent',
        dmarc: 'absent',
        authServId: 'dkim=pass',
      })
    })
  })
})

describe('hasAuthenticationFailure', () => {
  it('いずれかの方式が不合格なら true', () => {
    expect(hasAuthenticationFailure({ dkim: 'pass', spf: 'fail', dmarc: 'pass' })).toBe(true)
  })

  it('すべて合格なら false', () => {
    expect(hasAuthenticationFailure({ dkim: 'pass', spf: 'pass', dmarc: 'pass' })).toBe(false)
  })

  it('判定なしは不合格として扱わない（この段階では弾かないため、fail だけを目立たせる）', () => {
    expect(hasAuthenticationFailure({ dkim: 'absent', spf: 'absent', dmarc: 'absent' })).toBe(false)
  })
})
