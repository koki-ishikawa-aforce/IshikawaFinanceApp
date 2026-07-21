// PostToolUse(Edit|Write) フック: 編集されたファイルを Prettier で自動整形する。
// format:check 起因の CI 失敗と検証ループの1周を根絶するのが目的。
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const input = JSON.parse(await readStdin())
const filePath = input?.tool_input?.file_path
if (!filePath) process.exit(0)

const repoRoot = input?.cwd ?? process.cwd()
const resolved = path.resolve(repoRoot, filePath)

// リポジトリ外のファイル(プランファイル等)は対象外
if (!resolved.startsWith(repoRoot + path.sep)) process.exit(0)
if (!existsSync(resolved)) process.exit(0)

try {
  execFileSync('pnpm', ['exec', 'prettier', '--write', '--ignore-unknown', resolved], {
    cwd: repoRoot,
    stdio: 'ignore',
    timeout: 30_000,
  })
} catch {
  // 整形失敗でツール実行自体は妨げない(format:check が最終防衛線)
}
process.exit(0)

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    process.stdin.on('data', chunk => (data += chunk))
    process.stdin.on('end', () => resolve(data))
  })
}
