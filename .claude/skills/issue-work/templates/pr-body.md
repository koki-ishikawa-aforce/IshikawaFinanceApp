# PR 本文テンプレート(無人モード用)

無人モードで PR を作成するときの本文フォーマット。`.github/PULL_REQUEST_TEMPLATE.md` の必須項目(検証チェックリスト・Closes)を包含している。SKILL.md の「人間向け報告の執筆ルール」を必ず適用する。以下の `<!-- -->` は書き方の指示であり、出力には含めない。

---

## この PR でできるようになること

<!-- アプリを使う人の言葉で1〜3行。何の機能のどの部分が、どう変わる/できるようになるのか。
     例: 「ダッシュボードの支出グラフでカテゴリをタップすると、そのカテゴリの明細一覧に飛べるようになります」 -->

Closes #<Issue番号>

## あなたに判断してほしいこと

<!-- マージ判断 Issue へのリンクを必ず書く: 「判断ポイントは #<番号> にまとめています」。
     見送り追認の Issue があればここに列挙する(番号 + 1行説明)。
     マージ可否以外の判断ポイントがない場合はその旨も明記する: 「マージ可否以外の判断ポイントはありません。CI が green ならマージして問題ありません」 -->

## 実装内容

<!-- 技術的な変更点を「何を・なぜ」のセットで書く。パッケージごと(domain / adapters-neon / api / web)に分けると読みやすい。
     専門用語・略語には初出時に括弧で平易な説明を添える。判断に影響しない詳細は書かない。 -->

## 画面(スクリーンショット)

<!-- `packages/web` に変更がある場合のみ書く(変更が無ければこの節ごと削除する)。
     SKILL.md「UI 変更時のスクリーンショット添付」に従い、変更に関係する画面を darling / honey 両テーマで載せる。
     既存画面の見た目を変える変更なら、可能な範囲で変更前後を並べる。
     画像はコミット済み PNG を絶対 URL で参照する:
       ![変更後 darling](https://github.com/<owner>/<repo>/blob/<headブランチ>/docs/pr-screenshots/issue-<番号>/<screen>-darling.png?raw=true)
       ![変更後 honey](https://github.com/<owner>/<repo>/blob/<headブランチ>/docs/pr-screenshots/issue-<番号>/<screen>-honey.png?raw=true)
     撮影できなかった場合は、その旨と理由を1行記す(撮影失敗は PR 作成を止める理由にしない)。
     VRT スナップショットを更新した場合は、更新した画面名と理由(「受け入れ条件に基づく意図した UI 変更」等)をこの節に記す。 -->

## 検証

- [ ] `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check` が全て green
- [ ] adapters-neon の変更、または domain の振る舞い変更あり → 統合テスト(`test:integration`)も green / いずれも該当なし → 不要
- [ ] web の変更あり → VRT(`pnpm --filter @warimaru/web test:e2e`)も green / 変更なし → 不要
- [ ] VRT スナップショットを更新した → 更新理由を「画面」節に記載済み・スクリーンショット添付済み / 更新なし → 不要
- [ ] DDD レビュー(/ddd-review)を実施し、must-fix を解消済み
- [ ] web の変更あり → UI レビュー(/ui-review)を実施し、must-fix を解消済み / 変更なし → 不要

## 無人モードの選定理由

<!-- なぜこの Issue を選んだか(1〜3行)。優先順・依存チェックの結果を平易に -->
