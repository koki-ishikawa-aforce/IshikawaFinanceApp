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
 *
 * ここはソースの静的解析による回帰検出で、「実際に読み込まれないこと」自体は
 * pgLazyLoad.test.ts が読み込みの発生を観測して検証する。両方あるのは、静的解析は
 * 書き方の抜けに弱く、読み込み観測はモック越しの検証にとどまるため。
 *
 * **走査範囲を adapters-postgres の `src` に限る理由**: 本番の起動グラフの入口は
 * `packages/api` だが、`packages/api/package.json` は `pg` も `drizzle-orm` も依存に
 * 持たないため、api から直接これらを静的 import することはできない（pnpm は宣言して
 * いない依存を解決させない）。api に drizzle 系の依存が入った時点でこの前提は崩れるので、
 * そのときは走査範囲を広げること。
 */
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url))

/** 本番（neon-http）では読み込んではいけないモジュール。サブパス（`x/y`）も対象にする */
const LOCAL_ONLY_MODULES = ['pg', 'drizzle-orm/node-postgres']

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return listTypeScriptFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

/**
 * 実行時にモジュールを読み込む静的な import / export 文の参照先を集める。
 *
 * - `import 'x'` / `import ... from 'x'` / `export ... from 'x'` を対象にする
 *   （barrel の再エクスポートも本番の読み込みグラフへ引き込むため `export ... from` を含める）
 * - import 節が複数行に折り返された形も拾えるよう、文の区切り（行頭と `;`）と引用符だけを
 *   境界にして、途中の改行は許す。prettier の折り返し（printWidth 100）は開発者の意図と
 *   無関係に起きるため、1 行前提にすると回帰がちょうど検出できなくなる
 * - 動的 import（`await import('x')`）は実行時に初めて読み込むため、先に取り除いて対象外にする
 * - 型だけの import / export（`import type ...`）は実行時に消えるため対象外にする
 */
export function staticImportSources(source: string): string[] {
  const withoutDynamicImports = source.replace(/\bimport\s*\(\s*(['"])[^'"]*\1\s*\)/g, '')
  const withoutTypeOnly = withoutDynamicImports.replace(
    /(?:^|[;\n])\s*(?:import|export)\s+type\s+[^;'"]*?from\s+['"][^'"]+['"]/g,
    '\n',
  )
  return [
    ...withoutTypeOnly.matchAll(
      /(?:^|[;\n])\s*(?:import|export)\s+(?:[^;'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g,
    ),
  ].map(match => match[1] as string)
}

/** `pg` は `pg` 本体と `pg/lib/...` の両方を指す（サブパス経由で読み込まれても同じこと） */
export function referencesModule(importSource: string, moduleName: string): boolean {
  return importSource === moduleName || importSource.startsWith(`${moduleName}/`)
}

describe('ローカル開発専用ドライバは静的 import しない（#349）', () => {
  it.each(LOCAL_ONLY_MODULES)('src 配下に %s の静的 import が無い', moduleName => {
    const offenders = listTypeScriptFiles(SRC_DIR).filter(path =>
      staticImportSources(readFileSync(path, 'utf8')).some(source =>
        referencesModule(source, moduleName),
      ),
    )

    expect(offenders).toEqual([])
  })

  // 検出ロジックが回帰の書き方を取りこぼすと、上のテストは黙って green のままになる。
  // 「静的 import に戻す」ときに実際に現れる形をここで網羅して固定する。
  describe('検出ロジック', () => {
    it('1 行の静的 import を拾う', () => {
      expect(staticImportSources(`import { Pool } from 'pg'\n`)).toEqual(['pg'])
      expect(staticImportSources(`import 'pg'\n`)).toEqual(['pg'])
    })

    it('複数行に折り返された import 節を拾う', () => {
      expect(staticImportSources(`import {\n  Pool,\n} from 'pg'\n`)).toEqual(['pg'])
      expect(
        staticImportSources(`import {\n  drizzle,\n} from 'drizzle-orm/node-postgres'\n`),
      ).toEqual(['drizzle-orm/node-postgres'])
    })

    it('再エクスポートを拾う（barrel 経由で読み込みグラフへ引き込まれるため）', () => {
      expect(staticImportSources(`export { Pool } from 'pg'\n`)).toEqual(['pg'])
      expect(staticImportSources(`export * from 'pg'\n`)).toEqual(['pg'])
    })

    it('動的 import と型だけの import は対象外にする', () => {
      expect(staticImportSources(`const { Pool } = await import('pg')\n`)).toEqual([])
      expect(staticImportSources(`import type { Pool } from 'pg'\n`)).toEqual([])
      expect(staticImportSources(`import type {\n  Pool,\n} from 'pg'\n`)).toEqual([])
    })

    it('import 文でない文字列を誤検出しない', () => {
      expect(staticImportSources(`const message = 'imported from pg'\n`)).toEqual([])
    })
  })

  describe('モジュール名の一致判定', () => {
    it('サブパスも同じモジュールとして扱う', () => {
      expect(
        referencesModule('drizzle-orm/node-postgres/migrator', 'drizzle-orm/node-postgres'),
      ).toBe(true)
      expect(referencesModule('pg/lib/index.js', 'pg')).toBe(true)
    })

    it('名前が前方一致するだけの別モジュールは対象外', () => {
      expect(referencesModule('pg-protocol', 'pg')).toBe(false)
      expect(referencesModule('drizzle-orm/neon-http', 'drizzle-orm/node-postgres')).toBe(false)
    })
  })
})
