// PreToolUse(Bash) フック: 破壊的・規約違反コマンドのみをブロックする最小ガード。
// exit 2 + stderr で Claude にフィードバックされ、コマンドは実行されない。
const input = JSON.parse(await readStdin())
const command = input?.tool_input?.command ?? ''

const violations = [
  {
    // main への直接 push(PR 経由が規約)
    pattern: /git\s+push\b(?=.*\b(origin\s+main|main:main|origin\s+HEAD:main)\b)/,
    message:
      'main への直接 push は禁止です。フィーチャーブランチに push して PR を作成してください。',
  },
  {
    // force push(--force-with-lease は許可)
    pattern: /git\s+push\b(?=.*(\s--force\b|\s-f\b))(?!.*--force-with-lease)/,
    message: 'force push は禁止です。必要な場合は --force-with-lease を使ってください。',
  },
  {
    // migration ファイルを経由しない schema 反映
    pattern: /drizzle-kit\s+push\b/,
    message:
      'drizzle-kit push は禁止です。`pnpm --filter @warimaru/adapters-neon db:generate` でマイグレーションを生成してください。',
  },
  {
    // リポジトリルート・packages/ 配下の一括削除
    pattern:
      /rm\s+(-\w*[rf]\w*\s+)+(\/home\/\S*IshikawaFinanceApp\/?(\s|$)|packages\/?(\s|$)|\.\/?(\s|$)|\*)/,
    message:
      'リポジトリルートや packages/ を対象にした rm -rf はブロックしました。対象を個別に指定してください。',
  },
]

for (const { pattern, message } of violations) {
  if (pattern.test(command)) {
    console.error(message)
    process.exit(2)
  }
}
process.exit(0)

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    process.stdin.on('data', chunk => (data += chunk))
    process.stdin.on('end', () => resolve(data))
  })
}
