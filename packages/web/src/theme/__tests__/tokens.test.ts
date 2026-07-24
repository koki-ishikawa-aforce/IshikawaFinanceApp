import { describe, expect, it } from 'vitest'
import { CATEGORY_COLORS_DARLING, CATEGORY_COLORS_HONEY, getCategoryColors } from '../tokens'

describe('getCategoryColors', () => {
  it('テーマごとのカテゴリ色マップを返す', () => {
    expect(getCategoryColors('darling')).toBe(CATEGORY_COLORS_DARLING)
    expect(getCategoryColors('honey')).toBe(CATEGORY_COLORS_HONEY)
  })
})
