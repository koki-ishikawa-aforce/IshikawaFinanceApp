import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ローカル開発専用ドライバ（`pg` と `drizzle-orm/node-postgres`）を本番で読み込まないことを
 * 機械的に守る（#349）。
 *
 * 本番は neon-http だけを使うため、これらは node-postgres を選んだ時にだけ動的 import する。
 * 静的 import に戻すと、モジュールを評価するだけで（= 接続を作らなくても）本番の起動時に
 * 読み込まれてしまい、遅延読み込みが黙って無効になる。
 *
 * `drizzle-orm/node-postgres` も対象に含めるのが要点で、こちらは内部で `pg` を静的に
 * import している。`pg` だけを動的にしても、ドライバ経由で結局 `pg` が読み込まれる。
 */
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url))

/** 本番（neon-http）では読み込んではいけないモジュール */
const LOCAL_ONLY_MODULES = ['pg', 'drizzle-orm/node-postgres']

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return listTypeScriptFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

/**
 * 静的 import 文（`import ... from 'x'` / `import 'x'`）だけを拾う。
 * 動的 import（`await import('x')`）は `import(` の形なので from 節を持たず、ここには一致しない。
 * 型だけの import（`import type ... from 'x'`）は実行時に消えるため対象外。
 */
function staticImportSources(source: string): string[] {
  const withoutTypeImports = source.replace(/^\s*import\s+type\s[^\n]*$/gm, '')
  return [
    ...withoutTypeImports.matchAll(/^\s*import\s+(?:[^'"\n]*\sfrom\s+)?['"]([^'"]+)['"]/gm),
  ].map(m => m[1] as string)
}

describe('ローカル開発専用ドライバは静的 import しない（#349）', () => {
  it.each(LOCAL_ONLY_MODULES)('src 配下に %s の静的 import が無い', moduleName => {
    const offenders = listTypeScriptFiles(SRC_DIR).filter(path =>
      staticImportSources(readFileSync(path, 'utf8')).includes(moduleName),
    )

    expect(offenders).toEqual([])
  })

  it('検出ロジックが静的 import と動的 import を取り違えない', () => {
    expect(staticImportSources(`import { Pool } from 'pg'\n`)).toEqual(['pg'])
    expect(staticImportSources(`import 'pg'\n`)).toEqual(['pg'])
    expect(staticImportSources(`import type { Pool } from 'pg'\n`)).toEqual([])
    expect(staticImportSources(`const { Pool } = await import('pg')\n`)).toEqual([])
  })
})
