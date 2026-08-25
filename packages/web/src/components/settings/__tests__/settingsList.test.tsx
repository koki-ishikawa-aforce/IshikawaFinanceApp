import { describe, expect, it } from 'vitest'
import { definesClass, findDuplicateClassDefinitions, listStylesheets } from '@/test/stylesheets'

/**
 * 設定画面の一覧行の共通スタイル(settingsList.module.css)へ集約したクラスが、
 * タブ側の `*.module.css` に書き起こされていないことのガード(#642)。
 *
 * 集約前は `.accountRow`(口座タブ)と `.masterRow`(カテゴリ/経費種別/月次上限タブ)に
 * 同じ見た目がそれぞれ書かれており、片方だけ直すと揃わなくなっていた。
 *
 * `list` / `row` / `name` はアプリ内の他画面(残高・取引一覧・ダッシュボード等)にも
 * 同名の無関係なクラスが既に存在するため、名前だけを見るこのガードでは対象にできない
 * (無関係な既存クラスを誤検出してしまう)。`divider` と `rowActions` は設定タブ以外に
 * 同名クラスが存在しないため、ここでガードできる。
 */
const CONSOLIDATED = ['divider', 'rowActions'] as const

const OWNER_CSS = 'settingsList.module.css'

describe('設定画面の一覧行スタイルの重複定義の禁止', () => {
  it.each(CONSOLIDATED)(
    'settingsList.module.css 以外の .module.css に .%s が定義されていない',
    name => {
      // 走査自体が空振りしていないこと・正本が実際に定義していることを併せて確認する
      expect(listStylesheets().length).toBeGreaterThan(0)
      expect(definesClass(name, OWNER_CSS)).toBe(true)
      expect(findDuplicateClassDefinitions(name, OWNER_CSS)).toEqual([])
    },
  )
})
