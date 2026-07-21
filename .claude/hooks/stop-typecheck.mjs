// Stop フック: ターン終了時に「変更があったパッケージだけ」typecheck を実行する軽量チェック。
// 失敗時は exit 2 + stderr で Claude に差し戻し、型エラーを残したままターンを終えられなくする。
// フル検証(build/test/lint/format)は /verify スキルと CI の責務であり、ここではやらない。
import { execFileSync } from 'node:child_process'

const input = JSON.parse(await readStdin())

// Stop フック自身の差し戻しで再度呼ばれた場合は素通し(無限ループ防止)
if (input?.stop_hook_active) process.exit(0)

const repoRoot = input?.cwd ?? process.cwd()

let status = ''
try {
  status = execFileSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
  })
} catch {
  process.exit(0)
}

// 変更された .ts/.tsx から対象パッケージを特定(会話だけのターンでは何も走らない)
const pkgs = new Set()
for (const line of status.split('\n')) {
  const file = line.slice(3).trim()
  if (!/\.(ts|tsx)$/.test(file)) continue
  const m = file.match(/^packages\/([^/]+)\//)
  if (m) pkgs.add(m[1])
}
if (pkgs.size === 0) process.exit(0)

const failures = []
for (const pkg of pkgs) {
  try {
    execFileSync('pnpm', ['--filter', `./packages/${pkg}`, 'typecheck'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
  } catch (err) {
    failures.push(`--- packages/${pkg} ---\n${err.stdout ?? ''}${err.stderr ?? ''}`)
  }
}

if (failures.length > 0) {
  console.error(
    `変更されたパッケージの typecheck が失敗しています。修正してからターンを終えてください。\n${failures.join('\n')}`,
  )
  process.exit(2)
}
process.exit(0)

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    process.stdin.on('data', chunk => (data += chunk))
    process.stdin.on('end', () => resolve(data))
  })
}
