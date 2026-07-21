export const CATEGORY_COLORS_DARLING: Record<string, string> = {
  住居光熱通信: '#d8407a',
  食費: '#ff6f90',
  娯楽: '#ff9888',
  その他: '#c870b0',
}

export const CATEGORY_COLORS_HONEY: Record<string, string> = {
  住居光熱通信: '#1a4080',
  食費: '#3878c8',
  娯楽: '#48a8c0',
  その他: '#7080c0',
}

export const FALLBACK_CATEGORY_COLORS = [
  '#d8407a',
  '#ff6f90',
  '#ff9888',
  '#c870b0',
  '#e85080',
  '#ffa090',
  '#d098d0',
  '#f0a0b8',
]

export type Theme = 'darling' | 'honey'

const CATEGORY_COLORS: Record<Theme, Record<string, string>> = {
  darling: CATEGORY_COLORS_DARLING,
  honey: CATEGORY_COLORS_HONEY,
}

export function getCategoryColors(theme: Theme): Record<string, string> {
  return CATEGORY_COLORS[theme]
}

const DECORATIVE_EMOJI: Record<Theme, readonly string[]> = {
  darling: ['✨', '💖', '🌸'],
  honey: ['⭐', '⭐', '⭐'],
}

export function getDecorativeEmoji(theme: Theme): readonly string[] {
  return DECORATIVE_EMOJI[theme]
}

const HERO_DECORATION_EMOJI: Record<Theme, string> = {
  darling: '✨',
  honey: '⭐',
}

export function getHeroDecorationEmoji(theme: Theme): string {
  return HERO_DECORATION_EMOJI[theme]
}
