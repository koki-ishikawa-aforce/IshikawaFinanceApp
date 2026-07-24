## 概要

<!-- 何をなぜ変更したか(1〜3行) -->

Closes #

## 検証

- [ ] `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check` が全て green
- [ ] adapters-neon の変更、または domain の振る舞い変更あり → 統合テスト(`test:integration`)も green / いずれも該当なし → 不要
- [ ] web の変更あり → VRT(`pnpm --filter @warimaru/web test:e2e`)も green / 変更なし → 不要
- [ ] DDD レビュー(/ddd-review)を実施し、must-fix を解消済み
- [ ] web の変更あり → UI レビュー(/ui-review)を実施し、must-fix を解消済み / 変更なし → 不要
