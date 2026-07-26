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
| **機能適合性**(要求どおり動くか) | CI: `pnpm test`(単体・統合)、Playwright E2E / VRT<br>レビュー: `/ddd-review`(不変条件の置き場所)<br>プロセス: `/issue-work` 手順6(`docs/acceptance/` の AT シナリオとの照合)<br>人間: `docs/acceptance/` の受入テスト(#58) | ✅ 担保済み — Issue 単位の受け入れ条件は `/verify`、それがどの AT シナリオに当たるかは `/issue-work` 手順6 が照合して PR 本文に残す。**合否そのものの判定は本番受入テスト(#58)で人間が行う**ので、ここで担保されるのは「シナリオとの対応が追える状態を保つこと」まで |
| **性能効率**(初期表示・クエリ本数) | CI: バンドルサイズ予算(`pnpm --filter @warimaru/web bundle-size`)→ [bundle-budget.md](./bundle-budget.md)<br>レビュー: `/data-review`(N+1・索引欠落) | ✅ 担保済み — クエリ側(N+1・索引欠落・上限なしの取得)は `/data-review`、初期表示側はルートごとの gzip 予算を CI が担保<br>担保範囲の注記: 測るのは**配信量**(HTML が参照する js / css の gzip 合計)であり、実行時間・レンダリング速度・実機 LIFF での体感は含まない |
| **信頼性**(外部依存の失敗・冪等性・可観測性) | レビュー: `/reliability-review` | ✅ 担保済み — Gmail / LINE / Neon / SES の失敗時挙動、失敗の握りつぶし、イベント再実行の回復性、障害に気づけるかを `/reliability-review` が担保<br>担保範囲の注記: 担保するのは**新しい差分が失敗経路を増やさないこと**。構造化ログ・ログ収集・監視・アラート・相関 ID・リトライの各基盤は依然として存在せず、`safeSubscribe` 配下の失敗は `console.error` に留まる(能動通知はフェイルセーフメール1経路のみ) |
| **セキュリティ**(外周の攻撃面) | CI: `pnpm audit`(依存脆弱性)→ [dependency-audit.md](./dependency-audit.md)<br>レビュー: `/security-review`、`/ddd-review`(プライバシー3段階ルール = ドメイン内の可視性) | ✅ 担保済み — 依存脆弱性は CI、Webhook 署名検証・IDトークン検証・認可の位置・PII ログ流出は `/security-review` が担保 |
| **データ互換性**(スキーマ変更とデプロイ) | CI: 統合テスト(空の PostgreSQL への `migrate` 適用 = 構文と適用可能性)<br>レビュー: `/data-review` | ✅ 担保済み — 破壊的スキーマ変更・デプロイ順序・トランザクション境界・イベントハンドラの冪等性は `/data-review` が担保。CI が適用するのは**空の DB** なので、既存データがある本番で失敗する変更はレビュー側でしか捕まらない |
| **保守性**(設計・テスト品質) | CI: `pnpm lint` / `pnpm typecheck` / `pnpm format:check`<br>レビュー: `/ddd-review`(依存の向き・命名・ユビキタス言語・barrel)、`/test-review`(テストが振る舞いを検証しているか) | ✅ 担保済み — 設計規約は `/ddd-review`、テストが実装をなぞっただけになっていないか・境界値と異常系・否定形テスト・ピラミッドの置き場所は `/test-review` が担保 |
| **使用性**(使いやすさ) | 規範: [`docs/design/usability.md`](../design/usability.md)<br>レビュー: `/ux-review`、`/ui-review`(デザインシステム適合) | ✅ 担保済み — 規範を `/ux-review` が差分に適用する。ただし §9「既知の未対応」12件は未解消で、本レビューは**新しい画面で繰り返さないこと**を担保する |

判定の凡例: ✅ 担保済み / ⚠️ 部分的 / ❌ 未整備

`/ui-review` は **デザインシステム適合レビュー**(トークン規律・絵文字・テーマ両対応・aria / 色依存・`DESIGN.md` 整合)であり、使用性そのものは対象外。使用性は `docs/design/usability.md` を根拠に `/ux-review` が見る。両者の境界が近い3点(コントラスト比・ロール識別・フォーカス可視化)の分担は `.claude/agents/ux-reviewer.md` の「責務分担」に表で定義してある。

## 3. 変更パス → 起動するレビュー

`/issue-work` および PR 作成前に、差分の変更パスから起動するレビューを決める。

| 変更パス | 起動するレビュー | 状態 |
| --- | --- | --- |
| **常時**(すべての差分) | `/ddd-review` | ✅ 稼働中 |
| **常時**(コード変更を完了と報告する前・PR 作成前) | `/verify` | ✅ 稼働中 |
| `packages/web/**` | `/ui-review` | ✅ 稼働中 |
| `packages/web/**` のうち画面・フローの追加変更を含む差分<br>(`src/app/**` のページ・レイアウト、`src/components/**` の表示 / 操作を持つ部品、`src/hooks/**` の状態の扱い、`components/ui/common.module.css` の `.loading` / `.empty` / `.error` / `.button` 系) | `/ux-review` | ✅ 稼働中 |
| `packages/api/src/routes/**`<br>`packages/api/src/middleware/**`<br>`packages/api/src/gmail-oauth/**`<br>`packages/api/src/aws/**`(シークレット・トークンの取得/保管)<br>認証・外部連携(LINE / Gmail)の変更 | `/security-review` | ✅ 稼働中 |
| `packages/adapters-postgres/drizzle/**`(マイグレーション)<br>`packages/adapters-postgres/src/schema/**`(テーブル定義・索引・制約)<br>`packages/adapters-postgres/src/**`(Repository / Query 実装)<br>`packages/domain/src/*/events/**`・`packages/api/src/event-handlers/**`(再実行による二重適用の観点のみ) | `/data-review` | ✅ 稼働中 |
| `packages/domain/src/*/events/**`<br>`packages/api/src/event-handlers/**`<br>`packages/api/src/notification/**`<br>外部 API 呼び出しの追加・変更(`packages/api/src/gmail-oauth/**`・`pdf-conversion/**`・`aws/**`、その他 `fetch` / SDK 呼び出し) | `/reliability-review` | ✅ 稼働中 |
| テストファイル(`**/tests/**`・`**/__tests__/**`・`*.test.ts(x)`・`*.spec.ts`)を含む差分<br>`packages/domain/src/**` の振る舞い変更(テストを含まない場合も対象) | `/test-review` | ✅ 稼働中 |

複数該当する場合はすべて起動する。`/ddd-review` と `/verify` は常時なので、上表の該当分は「追加で回すもの」と読む。

ドメインイベントとそのハンドラの差分は `/data-review` と `/reliability-review` の両方に該当するが、見る面が違う(§1-3 の重複禁止に沿った切り分け)。`/data-review` は **再実行・二重発火の結果がデータに二重適用として残らないか**(永続化面)、`/reliability-review` は **失敗が握りつぶされていないか・失敗に気づけるか**(可観測性面)を見る。

該当が無い差分(docs のみの変更など)では `/ddd-review` の起動を省略してよい。省略した場合は PR 本文にその旨を書く。

`packages/web/**` の変更でも、色・余白・書体だけの変更やテスト / VRT スナップショットのみの差分では `/ux-review` を省略してよい(`/ui-review` は起動する)。省略の判定条件は `.claude/skills/ux-review/SKILL.md` の「起動条件」を正とする。

イベント型の**定義だけ**を追加し、購読も発行もまだ無い差分では `/reliability-review` を省略してよい(失敗経路が存在しないため)。

`/security-review` と `/reliability-review` は `gmail-oauth/**`・`aws/**` で二重に該当する。同じ箇所を別の面から見るため、見る面を次のとおり切り分ける(§1-3)。

| 対象 | `/security-review` が見る面 | `/reliability-review` が見る面 |
| --- | --- | --- |
| 外部 API 呼び出し | トークン・state の扱い、外部入力の検証 | タイムアウトの有無、失敗理由の区別、リトライ前提の誤り |
| ログ出力 | シークレット・PII の流出(`routes/**`・`middleware/**`・`gmail-oauth/**`・`aws/**`) | 障害を診断できる識別子が残るか。PII は `/security-review` が起動しないパス(イベントハンドラー・`notification/**`)に限って見る |

上表とは別に、`/issue-work` 手順6 の **受入シナリオとの照合**が同じタイミング(PR 作成前)で走る。これはレビューではなく、`docs/acceptance/` の AT シナリオと差分の対応を PR 本文に残す工程で、ドキュメント・開発プロセスだけの差分では省略してよい。手順は `.claude/skills/issue-work/SKILL.md` 手順6 を正とする。

### レビュー結果の扱い(全レビュー共通)

`/ddd-review` `/ui-review` と同じ規約に従う。

- must-fix は必ず修正する
- suggestion も **原則その場で修正する**(デフォルトは対応)
- 見送りは例外(修正範囲が今回の diff を大きく超える / 設計判断が要る)のみ。見送る場合は黙って放置せず Issue 化して追跡する(`needs-decision` を付けて `/decide` に接続する)
- 修正後は `/verify` を再実行して green を確認する

## 4. CI が担保している範囲

`.github/workflows/ci.yml` の verify ジョブ。すべて失敗が後続をブロックする。

レビュースキルと同じく、CI のステップも**変更パスで出し分ける**。実行枠(GitHub Actions の無料枠)は有限で、docs / skills だけの変更で Playwright まで回すと 1 run あたり 8 分を使い切るため。判定は `Detect changed paths` ステップが行い、**判定できないときは全ステップを実行する**(検証漏れを起こさない側に倒す)。

| 実行条件 | 対象 |
| --- | --- |
| `code` | `docs/` `.claude/` `*.md` **以外**の変更がある |
| `web` | `packages/web/` または `packages/domain/` の変更がある(domain は dist 経由で画面表示に波及する) |
| 常時 | 上記によらず必ず実行する |

| ステップ | 実行条件 | 担保する観点 |
| --- | --- | --- |
| `pnpm build` | `code` | ビルド可能性 |
| `pnpm --filter @warimaru/web bundle-size` | `code` | 初期表示ペイロードの予算(性能効率)→ [bundle-budget.md](./bundle-budget.md) |
| `pnpm typecheck` | `code` | 型整合(保守性) |
| `pnpm test` | `code` | 単体テストの成否(機能適合性) |
| `pnpm --filter @warimaru/adapters-postgres test:integration` | `code` | 実 PostgreSQL に対する永続化層の振る舞い |
| `pnpm --filter @warimaru/web test:e2e` | `web` | ビジュアルリグレッション(darling / honey 両テーマ) |
| `pnpm --filter @warimaru/e2e test:e2e` | `code` | 受入シナリオの E2E(AT-0xx / AT-2xx / AT-3xx) |
| `pnpm lint` | `code` | lint ルール + stylelint(トークン直値の機械判定) |
| `pnpm audit --audit-level moderate` | 常時 | 依存パッケージの既知脆弱性 → [dependency-audit.md](./dependency-audit.md) |
| `pnpm format:check` | 常時 | フォーマット(docs / skills の Markdown も対象) |

`main` への push(マージ後の検証)は変更パスによらず全ステップを実行する。また、同じ PR に push が続いたときは追い越された run をキャンセルする(`concurrency`)。

## 5. 観点を追加するときの手順

1. §1 の切り分け原則で **CI かレビュースキルか** を決める
2. §2 の対応表にその観点の行を追加(または既存行の担保手段を更新)する
3. レビュースキルの場合は §3 のトリガー表に起動条件を追加する。**無条件に常時起動にしない**(無人運用が破綻する)
   CI の場合は §4 の実行条件(`code` / `web` / 常時)を決めて表に追加する。数秒で終わるもの以外を常時実行にしない
4. 既存レビューとの責務分担をスキル冒頭に明記し、重複して指摘しないことを指示する
5. `CLAUDE.md` の開発フロー節に位置づけを追記する
