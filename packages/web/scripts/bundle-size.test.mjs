import { describe, expect, it } from 'vitest'

import {
  BYTES_PER_KIB,
  budgetForRoute,
  evaluateBudget,
  formatViolations,
  htmlPathToRoute,
  parseAssetRefs,
} from './bundle-size.mjs'

const budgetConfig = {
  default: { js: 10, css: 5, total: 16 },
  routes: {},
}

const measurement = (route, { js = 0, css = 0, html = 0, assets = [] } = {}) => ({
  route,
  js,
  css,
  html,
  total: js + css + html,
  assets,
})

describe('parseAssetRefs', () => {
  it('js と css の参照を重複なしで拾う', () => {
    const html = `
      <link rel="stylesheet" href="/_next/static/css/a.css"/>
      <script src="/_next/static/chunks/main-1.js"></script>
      <script src="/_next/static/chunks/main-1.js"></script>
    `
    expect(parseAssetRefs(html)).toEqual(['static/css/a.css', 'static/chunks/main-1.js'])
  })

  it('basePath 付きのビルドでも _next 配下の相対パスに正規化する', () => {
    const html = '<script src="/IshikawaFinanceApp/pr-1/_next/static/chunks/main-1.js"></script>'
    expect(parseAssetRefs(html)).toEqual(['static/chunks/main-1.js'])
  })

  it('RSC ペイロード内のエスケープされた参照をパスに混入させない', () => {
    const html = String.raw`<script>self.__next_f.push([1,"\"/_next/static/css/a.css\\\""])</script>`
    expect(parseAssetRefs(html)).toEqual(['static/css/a.css'])
  })

  it('画像やフォントなど js / css 以外は対象にしない', () => {
    const html =
      '<link href="/_next/static/media/font-1.woff2"/><img src="/_next/static/media/x.png"/>'
    expect(parseAssetRefs(html)).toEqual([])
  })
})

describe('htmlPathToRoute', () => {
  it.each([
    ['index.html', '/'],
    ['transactions.html', '/transactions'],
    ['404.html', '/404'],
    ['settings/notifications.html', '/settings/notifications'],
    ['settings/index.html', '/settings'],
  ])('%s → %s', (input, expected) => {
    expect(htmlPathToRoute(input)).toBe(expected)
  })
})

describe('budgetForRoute', () => {
  it('個別指定が無ければ default を使う', () => {
    expect(budgetForRoute(budgetConfig, '/transactions')).toEqual({ js: 10, css: 5, total: 16 })
  })

  it('個別指定は指定した指標だけを上書きし、残りは default を保つ', () => {
    const config = { default: { js: 10, css: 5, total: 16 }, routes: { '/reports': { js: 20 } } }
    expect(budgetForRoute(config, '/reports')).toEqual({ js: 20, css: 5, total: 16 })
  })

  it('routes が未定義の設定でも default にフォールバックする', () => {
    expect(budgetForRoute({ default: { js: 10 } }, '/')).toEqual({ js: 10 })
  })
})

describe('evaluateBudget', () => {
  it('予算内なら違反を返さない', () => {
    const measurements = [measurement('/', { js: 10 * BYTES_PER_KIB, css: 5 * BYTES_PER_KIB })]
    expect(evaluateBudget(measurements, budgetConfig)).toEqual([])
  })

  it('予算ちょうどは超過にしない(境界は予算に含める)', () => {
    const measurements = [measurement('/', { js: 10 * BYTES_PER_KIB })]
    expect(evaluateBudget(measurements, budgetConfig)).toEqual([])
  })

  it('1 バイトでも超えたら超過として報告する', () => {
    const measurements = [measurement('/', { js: 10 * BYTES_PER_KIB + 1 })]
    expect(evaluateBudget(measurements, budgetConfig)).toEqual([
      {
        route: '/',
        metric: 'js',
        actual: 10 * BYTES_PER_KIB + 1,
        limit: 10 * BYTES_PER_KIB,
        over: 1,
      },
    ])
  })

  it('同じルートで複数の指標が超えたらすべて報告する', () => {
    const measurements = [measurement('/', { js: 11 * BYTES_PER_KIB, css: 6 * BYTES_PER_KIB })]
    expect(evaluateBudget(measurements, budgetConfig).map(v => v.metric)).toEqual([
      'js',
      'css',
      'total',
    ])
  })

  it('超過したルートだけを報告し、予算内のルートは混ぜない', () => {
    const measurements = [
      measurement('/', { js: 1 * BYTES_PER_KIB }),
      measurement('/transactions', { js: 12 * BYTES_PER_KIB }),
    ]
    expect(evaluateBudget(measurements, budgetConfig).map(v => v.route)).toEqual(['/transactions'])
  })

  it('予算に無い指標は判定しない', () => {
    const config = { default: { js: 10 }, routes: {} }
    const measurements = [measurement('/', { js: 1 * BYTES_PER_KIB, css: 99 * BYTES_PER_KIB })]
    expect(evaluateBudget(measurements, config)).toEqual([])
  })
})

describe('formatViolations', () => {
  const measurements = [
    measurement('/transactions', {
      js: 12 * BYTES_PER_KIB,
      assets: [
        { file: '_next/static/chunks/heavy.js', kind: 'js', gzip: 8 * BYTES_PER_KIB },
        { file: '_next/static/chunks/small.js', kind: 'js', gzip: 4 * BYTES_PER_KIB },
      ],
    }),
  ]

  it('どのルートの何が・どれだけ超えたかを本文に含める', () => {
    const violations = evaluateBudget(measurements, budgetConfig)
    const output = formatViolations(violations, measurements)

    expect(output).toContain('/transactions')
    expect(output).toContain('js')
    expect(output).toContain('2.0 KiB 超過')
    expect(output).toContain('実測 12.0 KiB')
    expect(output).toContain('予算 10.0 KiB')
  })

  it('超過したルートで重い資産をサイズ降順で示す', () => {
    const violations = evaluateBudget(measurements, budgetConfig)
    const output = formatViolations(violations, measurements)

    expect(output).toContain('_next/static/chunks/heavy.js')
    expect(output.indexOf('heavy.js')).toBeLessThan(output.indexOf('small.js'))
  })

  it('複数ルートが超過しても資産の内訳は超過が最大のルート1件だけに絞る', () => {
    const many = [
      measurement('/small-over', {
        js: 11 * BYTES_PER_KIB,
        assets: [{ file: '_next/static/chunks/shared.js', kind: 'js', gzip: 11 * BYTES_PER_KIB }],
      }),
      measurement('/big-over', {
        js: 20 * BYTES_PER_KIB,
        assets: [{ file: '_next/static/chunks/shared.js', kind: 'js', gzip: 20 * BYTES_PER_KIB }],
      }),
    ]
    const output = formatViolations(evaluateBudget(many, budgetConfig), many)

    expect(output).toContain('超過が最大のルート /big-over で重い資産')
    expect(output).not.toContain('/small-over で重い資産')
    expect(output.match(/で重い資産/g)).toHaveLength(1)
  })
})
