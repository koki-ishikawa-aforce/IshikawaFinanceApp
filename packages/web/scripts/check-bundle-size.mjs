#!/usr/bin/env node
/**
 * バンドルサイズ予算のチェック(CI の入口)。
 *
 *   pnpm --filter @warimaru/web build        # 先に out/ を作る
 *   pnpm --filter @warimaru/web bundle-size
 *
 * 予算の根拠と、超えたときの判断手順: docs/review/bundle-budget.md
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  evaluateBudget,
  findHtmlFiles,
  formatMeasurementTable,
  formatViolations,
  measureRoute,
} from './bundle-size.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(packageRoot, 'out')
const budgetPath = path.join(packageRoot, 'bundle-budget.json')

async function main() {
  let htmlFiles
  try {
    htmlFiles = await findHtmlFiles(outDir)
  } catch {
    console.error(
      `ビルド成果物が見つかりません: ${outDir}\n` +
        '先に `pnpm --filter @warimaru/web build` を実行してください。',
    )
    process.exitCode = 1
    return
  }

  if (htmlFiles.length === 0) {
    console.error(
      `${outDir} に HTML がありません。ビルドが途中で失敗していないか確認してください。`,
    )
    process.exitCode = 1
    return
  }

  const budgetConfig = JSON.parse(await readFile(budgetPath, 'utf8'))
  const measurements = []
  for (const htmlFile of htmlFiles) {
    measurements.push(await measureRoute(outDir, htmlFile))
  }

  console.log('初期表示ペイロード(gzip・HTML が参照する js / css を含む)\n')
  console.log(formatMeasurementTable(measurements, budgetConfig))

  const violations = evaluateBudget(measurements, budgetConfig)
  if (violations.length === 0) {
    console.log('\n✓ すべてのルートが予算内です。')
    return
  }

  console.error(`\nバンドルサイズ予算を ${violations.length} 件超過しました。\n`)
  console.error(formatViolations(violations, measurements))
  console.error(
    '\n予算を上げてよいかの判断基準は docs/review/bundle-budget.md を参照してください' +
      '(意図した増加なら bundle-budget.json を根拠つきで更新する)。',
  )
  process.exitCode = 1
}

await main()
