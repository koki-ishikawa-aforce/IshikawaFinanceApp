import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * interactive transaction（複数文をまとめて成功/失敗させる仕組み）の使用禁止を機械的に守る。
 *
 * `db.transaction` は neon-http（本番）では実行時に throw する一方、
 * node-postgres（ローカル開発・統合テスト）では動いてしまう。#323 でローカル開発が
 * node-postgres で回るようになったため、「ローカルでは通るが本番でのみ壊れる」コードを
 * 書けてしまう。コメントによる注意喚起だけでは守れないため、テストで検出する。
 *
 * 解禁するときは WebSocket Pool のファクトリ追加とセットで判断する（M-B spec §2.5）。
 */
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url))

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return listTypeScriptFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

describe('adapters-neon の src は interactive transaction を使わない（#323 / M-B spec §2.5）', () => {
  it('src 配下に .transaction( の呼び出しが無い', () => {
    const offenders = listTypeScriptFiles(SRC_DIR).filter(path =>
      readFileSync(path, 'utf8').includes('.transaction('),
    )

    expect(offenders).toEqual([])
  })
})
