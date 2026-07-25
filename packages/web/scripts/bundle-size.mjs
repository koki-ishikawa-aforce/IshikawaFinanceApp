/**
 * web の静的書き出し(`next build` の `out/`)から、ルートごとの初期表示ペイロードを
 * 計測して予算と突き合わせる。CI から呼ばれる入口は check-bundle-size.mjs。
 *
 * 計測対象を「書き出された HTML が参照している資産」に置いているのは、Next.js の
 * ビルドログが出す First Load JS が polyfill と CSS を含まず、LIFF(LINE 内ブラウザ)で
 * 実際に落ちてくる量と一致しないため。HTML の参照は描画前に必ず取得されるので、
 * ここを測れば「初期表示までに何バイト落ちてくるか」を実態どおりに追える。
 *
 * 予算の根拠と運用: docs/review/bundle-budget.md
 */

import { gzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

/** 予算値の単位。JSON 側は KiB で書き、比較はバイトで行う。 */
export const BYTES_PER_KIB = 1024

/**
 * gzip 圧縮後のバイト数。level は固定する(既定値が変わると計測値が動くため)。
 * 配信時の実際の圧縮率は CDN 設定に依存するが、ここで見たいのは絶対値ではなく
 * 変化量なので、再現可能な単一の基準で測れば足りる。
 */
export function gzipSize(buffer) {
  return gzipSync(buffer, { level: 9 }).length
}

/**
 * HTML が参照している `_next/static` 配下の js / css を、出現順の重複なしで返す。
 * 返すパスは `out/_next/` からの相対(例: `static/chunks/webpack-abc.js`)。
 *
 * basePath 付きビルド(PR プレビュー配信)では `/<repo>/pr-1/_next/...` になるため、
 * `_next/` より前は読み捨てる。HTML には生の属性値だけでなく、RSC ペイロード内の
 * エスケープされた参照も現れるので、終端は引用符とバックスラッシュの手前で切る。
 */
export function parseAssetRefs(html) {
  const pattern = /_next\/(static\/[^"'\\\s]+?\.(?:js|css))/g
  return [...new Set([...html.matchAll(pattern)].map(match => match[1]))]
}

/** `out/` からの相対 HTML パスをルート表記に直す(`index.html` → `/`)。 */
export function htmlPathToRoute(relativePath) {
  const withoutExtension = relativePath.replace(/\.html$/, '')
  const route = withoutExtension === 'index' ? '' : withoutExtension.replace(/\/index$/, '')
  return `/${route}`.replace(/\/{2,}/g, '/')
}

/** ディレクトリ配下の HTML を再帰的に集める(`out/` からの相対パス)。 */
export async function findHtmlFiles(outDir, subDir = '') {
  const entries = await readdir(path.join(outDir, subDir), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = subDir === '' ? entry.name : `${subDir}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await findHtmlFiles(outDir, relativePath)))
    } else if (entry.name.endsWith('.html')) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

/**
 * ルート1件分の内訳を計測する。同じチャンクを複数ルートが共有していても、
 * ルート単位では「そのルートを開いた人が落とす量」を見たいので都度加算する。
 */
export async function measureRoute(outDir, htmlRelativePath) {
  const htmlBuffer = await readFile(path.join(outDir, htmlRelativePath))
  const refs = parseAssetRefs(htmlBuffer.toString('utf8'))

  const assets = []
  for (const ref of refs) {
    const buffer = await readFile(path.join(outDir, '_next', ref))
    assets.push({
      file: `_next/${ref}`,
      kind: ref.endsWith('.js') ? 'js' : 'css',
      gzip: gzipSize(buffer),
    })
  }

  const sum = kind => assets.filter(a => a.kind === kind).reduce((total, a) => total + a.gzip, 0)
  const html = gzipSize(htmlBuffer)
  const js = sum('js')
  const css = sum('css')

  return {
    route: htmlPathToRoute(htmlRelativePath),
    html,
    js,
    css,
    total: html + js + css,
    assets: assets.sort((a, b) => b.gzip - a.gzip),
  }
}

/** ルートに適用する予算(KiB)。`routes` の個別指定があればそれを優先する。 */
export function budgetForRoute(budgetConfig, route) {
  return { ...budgetConfig.default, ...(budgetConfig.routes?.[route] ?? {}) }
}

/**
 * 計測結果を予算と突き合わせ、超過分を列挙する。
 * 予算に無い指標(将来 `html` を足した場合など)は判定しない。
 */
export function evaluateBudget(measurements, budgetConfig) {
  const violations = []
  for (const measurement of measurements) {
    const budget = budgetForRoute(budgetConfig, measurement.route)
    for (const metric of ['js', 'css', 'total']) {
      const budgetKib = budget[metric]
      if (budgetKib === undefined) continue
      const limit = budgetKib * BYTES_PER_KIB
      if (measurement[metric] > limit) {
        violations.push({
          route: measurement.route,
          metric,
          actual: measurement[metric],
          limit,
          over: measurement[metric] - limit,
        })
      }
    }
  }
  return violations
}

export function formatKib(bytes) {
  return `${(bytes / BYTES_PER_KIB).toFixed(1)} KiB`
}

/** 全ルートの計測結果。超過の有無にかかわらず出して、CI ログに推移を残す。 */
export function formatMeasurementTable(measurements, budgetConfig) {
  const rows = [
    ['route', 'js', 'css', 'html', 'total', 'total 予算'],
    ...measurements.map(m => {
      const budget = budgetForRoute(budgetConfig, m.route)
      return [
        m.route,
        formatKib(m.js),
        formatKib(m.css),
        formatKib(m.html),
        formatKib(m.total),
        budget.total === undefined ? '-' : formatKib(budget.total * BYTES_PER_KIB),
      ]
    }),
  ]

  // ルート名は長さがまちまちなので、列幅は実データから決める(固定幅だと桁が崩れる)
  const widths = rows[0].map((_, column) => Math.max(...rows.map(row => row[column].length)))
  return rows
    .map(row =>
      row
        .map((cell, i) => cell.padEnd(widths[i]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n')
}

/**
 * 超過の内訳。「どのルートの何が・予算をどれだけ超えたか」を全件並べ、
 * そのうえで最も超過が大きいルートの重い資産を出す(最初に見る場所を示すため)。
 *
 * 資産の内訳を1ルートに絞るのは、共有チャンクがほぼ全ルートで同じ顔ぶれになり、
 * 全ルート分並べると同じ表が繰り返されて肝心の超過行が埋もれるため。
 */
export function formatViolations(violations, measurements, topAssets = 5) {
  const lines = violations.map(
    violation =>
      `✗ ${violation.route} の ${violation.metric} が予算を ${formatKib(violation.over)} 超過` +
      ` (実測 ${formatKib(violation.actual)} / 予算 ${formatKib(violation.limit)})`,
  )

  const worst = [...violations].sort((a, b) => b.over - a.over)[0]
  const measurement = measurements.find(m => m.route === worst?.route)
  if (measurement) {
    lines.push('', `超過が最大のルート ${measurement.route} で重い資産(gzip 上位 ${topAssets} 件):`)
    for (const asset of measurement.assets.slice(0, topAssets)) {
      lines.push(`  ${formatKib(asset.gzip).padStart(10)}  ${asset.file}`)
    }
  }
  return lines.join('\n')
}
