/**
 * ローカル開発専用ドライバ（`pg`）を本番向けの配布物から外したこと（#428）を、
 * 依存宣言の位置で守る。
 *
 * 本番は neon-http だけを使い、`pg` はローカル開発と統合テストでしか読み込まない（#349）。
 * その前提のもとで依存宣言も devDependencies へ移したが、`dependencies` に戻っても
 * **動いてしまう**（本番でも読み込まれないまま配布物にだけ入る）ため、回帰は誰にも見えない。
 *
 * 走査対象を adapters-postgres 1 つに閉じないのは、`pg` を本番向けインストールへ引き戻すのに
 * 「adapters-postgres の宣言を戻す」以外の道があるため。ワークスペース内のどのパッケージが
 * `dependencies` に足しても同じ結果になる（noStaticNodePgImport.test.ts が
 * 「api は pg も drizzle-orm も依存に持たない」を走査範囲の前提に置いているのと同じ理由）。
 *
 * ドライバの読み込みそのものの振る舞いは nodePgDriverLoadError.test.ts が受け持つ。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const SELF = 'packages/adapters-postgres/package.json'

/** ワークスペースの全 manifest（root + packages/* + e2e）。パスは表示のためリポジトリ相対で持つ */
function workspaceManifests(): { path: string; manifest: PackageManifest }[] {
  const packagePaths = readdirSync(join(REPO_ROOT, 'packages')).map(
    entry => `packages/${entry}/package.json`,
  )
  return ['package.json', ...packagePaths, 'e2e/package.json'].map(path => ({
    path,
    manifest: JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as PackageManifest,
  }))
}

describe('pg の依存宣言（#428）', () => {
  const manifests = workspaceManifests()
  const self = manifests.find(({ path }) => path === SELF)?.manifest

  it('ワークスペースのどのパッケージも pg を dependencies に宣言していない', () => {
    const declaredInProduction = manifests
      .filter(({ manifest }) => manifest.dependencies?.['pg'] !== undefined)
      .map(({ path }) => path)

    expect(declaredInProduction).toEqual([])
  })

  it('adapters-postgres は pg と型定義を devDependencies に宣言している', () => {
    // 「dependencies に無い」だけだと、宣言ごと消えた（= 手元でも解決できない）状態も通ってしまう
    expect(self?.devDependencies).toHaveProperty('pg')
    expect(self?.devDependencies).toHaveProperty('@types/pg')
  })

  it('本番の neon-http 経路が使う依存は dependencies に残っている', () => {
    // 「全部 devDependencies へ移した」という別の壊れ方は、上の 2 件では検出できない。
    // src/client.ts が静的 import する 2 つ（@neondatabase/serverless と drizzle-orm）が対象
    expect(self?.dependencies).toHaveProperty('@neondatabase/serverless')
    expect(self?.dependencies).toHaveProperty('drizzle-orm')
    expect(self?.devDependencies ?? {}).not.toHaveProperty('@neondatabase/serverless')
    expect(self?.devDependencies ?? {}).not.toHaveProperty('drizzle-orm')
  })
})
