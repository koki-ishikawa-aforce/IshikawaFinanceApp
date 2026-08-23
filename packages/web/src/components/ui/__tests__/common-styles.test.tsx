import { describe, expect, it } from 'vitest'
import { definesClass, findDuplicateClassDefinitions, listStylesheets } from '@/test/stylesheets'

/**
 * 共通スタイルへ集約したクラスが、画面側の `*.module.css` に書き起こされていないことの
 * ガード(#462)。
 *
 * 集約前は同じ見た目が設定ページと学習タブに別々に書かれており、片方だけ直しても
 * もう片方が古いまま残った。名前が同じ重複はここで機械的に止める。
 *
 * `.note`(補足文)は値の違う定義が 3 画面に残っているため、まだこのガードに載せられない
 * (統合するか別クラスにするかの判断は #473)。
 */
const CONSOLIDATED = ['warning', 'textButton', 'textButtonDanger'] as const

const COMMON_CSS = 'common.module.css'

describe('共通スタイルの重複定義の禁止', () => {
  it.each(CONSOLIDATED)('common.module.css 以外の .module.css に .%s が定義されていない', name => {
    // 走査自体が空振りしていないこと・正本が実際に定義していることを併せて確認する
    expect(listStylesheets().length).toBeGreaterThan(0)
    expect(definesClass(name, COMMON_CSS)).toBe(true)
    expect(findDuplicateClassDefinitions(name, COMMON_CSS)).toEqual([])
  })
})
