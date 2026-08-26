## 概要

<!-- 何をなぜ変更したか(1〜3行) -->

Closes #

## レビュー結果

<!-- 各レビュー(/ddd-review 等)の suggestion のうち、見送り基準 (a)(独立した PR が必要な別リファクタリング相当の規模)に該当し
     その場で修正しなかったものを、指摘内容と見送り理由のセットで列挙する。
     見送り基準 (b)(設計判断)に該当するものは `[判断待ち]` Issue を起票する。
     見送った suggestion が無ければ省略してよい。 -->

## 受け入れシナリオ(AT)

<!-- `docs/acceptance/` の該当シナリオ(AT 番号)と、どの期待結果に対応するか。
     シナリオを追加・更新した場合はその AT 番号と内容。
     該当なしと判断した場合はその理由を1行。
     判定の手順は `.claude/skills/issue-work/SKILL.md` 手順6 -->

## 検証

- [ ] `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check` が全て green
- [ ] adapters-postgres の変更、または domain の振る舞い変更あり → 統合テスト(`test:integration`)も green / いずれも該当なし → 不要
- [ ] web の変更あり → VRT(`pnpm --filter @warimaru/web test:e2e`)も green / 変更なし → 不要
- [ ] DDD レビュー(/ddd-review)を実施し、must-fix を解消済み
- [ ] web の変更あり → UI レビュー(/ui-review)を実施し、must-fix を解消済み / 変更なし → 不要
- [ ] `docs/acceptance/` の受入シナリオと照合済み(結果を「受け入れシナリオ(AT)」節に記載) / ドキュメント・開発プロセスのみの差分 → 不要
