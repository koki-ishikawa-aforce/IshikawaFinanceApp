import { describe, expect, it } from 'vitest'
import {
  CATEGORY_COLORS_DARLING,
  CATEGORY_COLORS_HONEY,
  getCategoryColors,
  getDecorativeEmoji,
  getHeroDecorationEmoji,
} from '../tokens'

describe('getCategoryColors', () => {
  it('テーマごとのカテゴリ色マップを返す', () => {
    expect(getCategoryColors('darling')).toBe(CATEGORY_COLORS_DARLING)
    expect(getCategoryColors('honey')).toBe(CATEGORY_COLORS_HONEY)
  })
})

describe('getHeroDecorationEmoji', () => {
  it('darling は ✨、honey は ⭐ を返す', () => {
    expect(getHeroDecorationEmoji('darling')).toBe('✨')
    expect(getHeroDecorationEmoji('honey')).toBe('⭐')
  })
})

describe('getDecorativeEmoji', () => {
  it('テーマごとの背景装飾絵文字を返す', () => {
    expect(getDecorativeEmoji('darling')).toEqual(['✨', '💖', '🌸'])
    expect(getDecorativeEmoji('honey')).toEqual(['⭐', '⭐', '⭐'])
  })
})
