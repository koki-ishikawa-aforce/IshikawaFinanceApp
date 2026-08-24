import { describe, expect, it, vi } from 'vitest'
import { getCurrentMonth } from '@/lib/month'
import { MOCK_DEFAULT_MONTH, MOCK_NOW } from '../clock'

describe('モック起動モードの「今」', () => {
  // 見た目の自動チェックはこの日時を「今」として撮る(#506)。fixture の標準月とずれると、
  // 見出しは 8 月・中身は 7 月といった食い違った画面を基準画像として固定してしまう。
  // 片方だけ動かしたときにここで落として気づけるようにする
  it('固定日時が属する月(JST)は fixture の標準月と一致する', () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', MOCK_NOW)

    expect(getCurrentMonth()).toBe(MOCK_DEFAULT_MONTH)
  })
})
