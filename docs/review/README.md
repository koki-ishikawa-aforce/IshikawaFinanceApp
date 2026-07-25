# レビュー観点の体系と起動トリガー

割まる(わりまる)の品質を「誰が・どこで・何を見るか」に分解した一次資料。レビュー観点を追加するときは、必ず本ドキュメントの表に位置づけてから追加する。

> 関連: [`CLAUDE.md`](../../CLAUDE.md)(開発フロー)、[`DESIGN.md`](../../DESIGN.md)(見た目の規約)、[`docs/design/usability.md`](../design/usability.md)(使用性の規範)、[`docs/acceptance/README.md`](../acceptance/README.md)(受入テスト)

## 1. 切り分けの原則

観点を追加する前に、まずどの手段で担保するかを決める。

1. **機械が判定できる観点は CI に寄せる。レビュースキルには含めない**
   閾値・パターン・型で自動判定できるものは CI のステップにする。理由は 3 つある。(a) 見落としが起きない、(b) レビュースキルの観点が増えるほど 1 観点あたりの精度が落ちる、(c) 無人運用(`/issue-work`)の 1 サイクルが重くなる。
   例: フォーマット、lint ルール、型、テストの成否、依存パッケージの既知脆弱性、バンドルサイズ。

2. **設計判断が要る観点はレビュースキルに置く**
   「この配置が集約境界として妥当か」「この空状態が利用者に次の行動を示しているか」のように、正解が文脈依存で閾値を切れないものはレビュースキルが担当する。

3. **同じ観点を 2 か所で見ない**
   CI が判定している観点をレビュースキルの観点表に重複して書かない。逆も同じ。重複はレビュー時間を無駄にし、片方だけが更新されて食い違う原因になる。
   例: `*.module.css` の直値は stylelint が機械的に落とすため、`ui-reviewer` は「stylelint が拾えない境界例(インライン style・`calc()` 内の直値など)」に限って見る。

4. **人間にしか判断できないものは人間に残す**
   マージ判断、本番受入テストの合否、実機 LIFF での体験、リスクの受容。無人モードはこれらを代行しない(`CLAUDE.md` の「マージ判断は必ず人間が行う」)。

## 2. 品質特性ごとの担保手段

ISO/IEC 25010 の品質特性を下敷きに、割まるで意味のある 6 特性 + データ互換性について整理する。

| 品質特性 | 担保手段 | 現状 |
| --- | --- | --- |
| **機能適合性**(要求どおり動くか) | CI: `pnpm test`(単体・統合)、Playwright E2E / VRT<br>レビュー: `/ddd-review`(不変条件の置き場所)<br>人間: `docs/acceptance/` の受入テスト(#58) | ⚠️ 部分的 — Issue 単位の受け入れ条件は `/verify` で見るが、`docs/acceptance/` のどの AT シナリオを満たしたかを照合する工程が無い(#333) |
| **性能効率**(初期表示・クエリ本数) | CI: バンドルサイズ予算(#332)<br>レビュー: N+1・インデックス欠落はデータレビュー(#328) | ❌ 未整備 — 計測基盤が無く、劣化しても気づけない(#332) |
| **信頼性**(外部依存の失敗・冪等性・可観測性) | レビュー: 信頼性・可観測性レビュー(#331) | ❌ 未整備 — Gmail / LINE / Neon の失敗時挙動とイベントハンドラの再実行安全性を誰も見ていない(#331) |
| **セキュリティ**(外周の攻撃面) | CI: `pnpm audit`(依存脆弱性)→ [dependency-audit.md](./dependency-audit.md)<br>レビュー: `/security-review`、`/ddd-review`(プライバシー3段階ルール = ドメイン内の可視性) | ✅ 担保済み — 依存脆弱性は CI、Webhook 署名検証・IDトークン検証・認可の位置・PII ログ流出は `/security-review` が担保 |
| **データ互換性**(スキーマ変更とデプロイ) | レビュー: データ・マイグレーション互換性レビュー(#328) | ❌ 未整備 — `db:generate` は生成物の構文的正しさしか保証せず、既存データ・デプロイ順序の安全性は未判定(#328) |
| **保守性**(設計・テスト品質) | CI: `pnpm lint` / `pnpm typecheck` / `pnpm format:check`<br>レビュー: `/ddd-review`(依存の向き・命名・ユビキタス言語・barrel)、`/test-review`(テストが振る舞いを検証しているか) | ✅ 担保済み — 設計規約は `/ddd-review`、テストが実装をなぞっただけになっていないか・境界値と異常系・否定形テスト・ピラミッドの置き場所は `/test-review` が担保 |
| **使用性**(使いやすさ) | 規範: [`docs/design/usability.md`](../design/usability.md)<br>レビュー: `/ux-review`(#330)、`/ui-review`(デザインシステム適合) | ⚠️ 部分的 — 規範は言語化済み。レビュー工程への接続が未整備(#330) |

判定の凡例: ✅ 担保済み / ⚠️ 部分的 / ❌ 未整備

`/ui-review` は **デザインシステム適合レビュー**(トークン規律・絵文字・テーマ両対応・aria / 色依存・`DESIGN.md` 整合)であり、使用性そのものは対象外。使用性は `docs/design/usability.md` を根拠に `/ux-review` が見る(#330 で新設)。

## 3. 変更パス → 起動するレビュー

`/issue-work` および PR 作成前に、差分の変更パスから起動するレビューを決める。

| 変更パス | 起動するレビュー | 状態 |
| --- | --- | --- |
| **常時**(すべての差分) | `/ddd-review` | ✅ 稼働中 |
| **常時**(コード変更を完了と報告する前・PR 作成前) | `/verify` | ✅ 稼働中 |
| `packages/web/**` | `/ui-review` | ✅ 稼働中 |
| `packages/web/**` のうち画面・フローの追加変更を含む差分 | `/ux-review` | ❌ #330 |
| `packages/api/src/routes/**`<br>`packages/api/src/middleware/**`<br>`packages/api/src/gmail-oauth/**`<br>`packages/api/src/aws/**`(シークレット・トークンの取得/保管)<br>認証・外部連携(LINE / Gmail)の変更 | `/security-review` | ✅ 稼働中 |
| `packages/adapters-neon/**`(特に `drizzle/`(マイグレーション)・`src/**/queries/`) | データ・マイグレーション互換性レビュー | ❌ #328 |
| `packages/domain/src/*/events/**`<br>`packages/api/src/event-handlers/**`<br>`packages/api/src/notification/**` | 信頼性・可観測性レビュー | ❌ #331 |
| テストファイル(`**/tests/**`・`**/__tests__/**`・`*.test.ts(x)`・`*.spec.ts`)を含む差分<br>`packages/domain/src/**` の振る舞い変更(テストを含まない場合も対象) | `/test-review` | ✅ 稼働中 |

複数該当する場合はすべて起動する。`/ddd-review` と `/verify` は常時なので、上表の該当分は「追加で回すもの」と読む。

該当が無い差分(docs のみの変更など)では `/ddd-review` の起動を省略してよい。省略した場合は PR 本文にその旨を書く。

### レビュー結果の扱い(全レビュー共通)

`/ddd-review` `/ui-review` と同じ規約に従う。

- must-fix は必ず修正する
- suggestion も **原則その場で修正する**(デフォルトは対応)
- 見送りは例外(修正範囲が今回の diff を大きく超える / 設計判断が要る)のみ。見送る場合は黙って放置せず Issue 化して追跡する(`needs-decision` を付けて `/decide` に接続する)
- 修正後は `/verify` を再実行して green を確認する

## 4. CI が担保している範囲

`.github/workflows/ci.yml` の verify ジョブ。すべて失敗が後続をブロックする。

| ステップ | 担保する観点 |
| --- | --- |
| `pnpm build` | ビルド可能性 |
| `pnpm typecheck` | 型整合(保守性) |
| `pnpm test` | 単体テストの成否(機能適合性) |
| `pnpm --filter @warimaru/adapters-neon test:integration` | 実 PostgreSQL に対する永続化層の振る舞い |
| `pnpm --filter @warimaru/web test:e2e` | ビジュアルリグレッション(darling / honey 両テーマ) |
| `pnpm --filter @warimaru/e2e test:e2e` | 受入シナリオの E2E(AT-0xx / AT-2xx / AT-3xx) |
| `pnpm lint` | lint ルール + stylelint(トークン直値の機械判定) |
| `pnpm audit --audit-level moderate` | 依存パッケージの既知脆弱性 → [dependency-audit.md](./dependency-audit.md) |
| `pnpm format:check` | フォーマット |

## 5. 観点を追加するときの手順

1. §1 の切り分け原則で **CI かレビュースキルか** を決める
2. §2 の対応表にその観点の行を追加(または既存行の担保手段を更新)する
3. レビュースキルの場合は §3 のトリガー表に起動条件を追加する。**無条件に常時起動にしない**(無人運用が破綻する)
4. 既存レビューとの責務分担をスキル冒頭に明記し、重複して指摘しないことを指示する
5. `CLAUDE.md` の開発フロー節に位置づけを追記する
