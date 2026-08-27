# Claude Code 実行基盤

ワークフローを実際に動かしている層 — skill・サブエージェント・hooks・Routine — の一覧と責務。**設定の実体は `.claude/` 配下**にあり、本書はその地図。

構成は4層に分かれる。

| 層 | 実体 | 役割 | 更新経路 |
| --- | --- | --- | --- |
| **手順** | `.claude/skills/*/SKILL.md`(16) | 何をどの順でやるか | リポジトリ(PR 経由) |
| **実行者** | `.claude/agents/*.md`(7) | レビューを読み取り専用で実行する | リポジトリ(PR 経由) |
| **ガード** | `.claude/settings.json` + `.claude/hooks/*.mjs`(3) | 規約違反を実行時に不可能にする | リポジトリ(PR 経由) |
| **起動** | Routine(4) | いつ誰が起動するか | **claude.ai の画面のみ**(§5) |

**手順をリポジトリ側に置き、起動側(Routine のプロンプト)を薄く保つ**のが基本方針。更新経路が限られる層に手順を書くと必ず乖離する(§5)。

## 1. skill(手順)

| 種別 | skill | 起動者 | 役割 |
| --- | --- | --- | --- |
| 工程 | `/issue-create` | 人間 | 要件をヒアリングして Issue 化。作成時に ready 判定まで行う |
| 工程 | `/backlog-ready` | 人間 | open Issue をまとめて ready 判定し、承認ラベルを付ける |
| 工程 | `/issue-work` | 人間 / **Routine(無人)** | Issue 起点の実装 → PR → CI → マージ。**マージゲートの唯一の定義**を持つ |
| 工程 | `/verify` | 他スキルから / 人間 | CI と同一のチェックをローカルで全 green にする |
| 工程 | `/decide` | 人間 | `needs-decision` を対話で消化し、決定を Issue と docs に反映する |
| レビュー | `/ddd-review` | 常時(全差分) | DDD・ヘキサゴナル規約、プライバシー3段階ルール |
| レビュー | `/ui-review` | `packages/web` の変更時 | `DESIGN.md` 適合(トークン・テーマ・絵文字・a11y) |
| レビュー | `/ux-review` | 画面・フローの追加変更時 | `docs/design/usability.md` の規範(状態の網羅・入力負荷・マイクロコピー) |
| レビュー | `/test-review` | テストを含む差分 / domain の振る舞い変更 | テストが実際に振る舞いを検証しているか |
| レビュー | `/security-review` | API の外周・認証・外部連携の変更時 | 署名検証・トークン検証・認可の位置・PII 流出 |
| レビュー | `/data-review` | マイグレーション・スキーマ・Query・イベントハンドラの変更時 | 既存データとデプロイに対する安全性 |
| レビュー | `/reliability-review` | イベント・通知・外部 API の変更時 | 失敗時の挙動・握りつぶし・再実行の回復性 |
| 運用 | `/pr-steward` | **Routine** | open な自動 PR の CI 修復・コンフリクト解消・重複検知。**マージはしない** |
| 運用 | `/retro` | **Routine** | 無人運用の失敗データから改善案を起票(読み取り専用) |
| 運用 | `/docs-drift` | **Routine** | `docs/domain` とコードの乖離を検知して起票(読み取り専用) |
| 運用 | `/workflow-review` | **Routine** | 外部知識体系とライフサイクル網羅表を物差しに、動いていない工程の欠落を検知して起票(読み取り専用・実施記録の追加を除く) |

レビュースキルの**起動条件の正**は `docs/review/README.md` §3 のトリガー表。上表は一覧のための要約であり、判定にはトリガー表を使う。

## 2. サブエージェント(レビューの実行者)

`.claude/agents/` に7つ。skill が「いつ・何を見るか」を決め、サブエージェントが「実際に差分を読んで指摘する」。

| サブエージェント | 対応 skill | ツール |
| --- | --- | --- |
| `ddd-reviewer` | `/ddd-review` | Read / Grep / Glob / Bash |
| `ui-reviewer` | `/ui-review` | 同上 |
| `ux-reviewer` | `/ux-review` | 同上 |
| `test-reviewer` | `/test-review` | 同上 |
| `security-reviewer` | `/security-review` | 同上 |
| `data-reviewer` | `/data-review` | 同上 |
| `reliability-reviewer` | `/reliability-review` | 同上 |

全員が**読み取り専用**(Edit / Write を持たない)。指摘を返すだけで、修正はメインのセッションが行う。レビューと修正を同じ主体が同時に行うと「自分の修正を自分で承認する」構造になるため、権限で分離している。

責務が近いレビュー同士(`/ui-review` と `/ux-review`、`/security-review` と `/reliability-review`、`/data-review` と `/reliability-review`)は、**境界を表で明示的に切り分けて重複指摘を禁じている**。切り分けの定義は各エージェント定義の「責務分担」節と `docs/review/README.md` §3 にある。

## 3. hooks(実行時ガード)

`.claude/settings.json` で3つの hook を登録している。いずれも**プロンプトでの禁止ではなく、実行時に不可能にする**ための層。

| hook | 契機 | 何をするか | なぜこの位置か |
| --- | --- | --- | --- |
| `format-after-edit.mjs` | `PostToolUse`(Edit / Write) | 編集されたファイルを Prettier で整形 | `format:check` 起因の CI 失敗と検証ループ1周を**原理的に消す**。整形は判断が要らないので、人にも AI にも見せる必要がない |
| `guard-bash.mjs` | `PreToolUse`(Bash) | 規約違反コマンドを exit 2 でブロック(コマンドは実行されない) | プロンプトで禁じたことは確率的にしか守られない。**破壊的操作は確率に委ねない** |
| `stop-typecheck.mjs` | `Stop`(ターン終了時) | 変更があったパッケージだけ `typecheck` を実行し、失敗なら exit 2 で差し戻す | 型エラーを残したままターンを終えられなくする。フル検証は `/verify` と CI の責務なので**ここには持ち込まない**(ターン終了のたびに数分待つことになる) |

### `guard-bash.mjs` がブロックするもの

| パターン | 理由 |
| --- | --- |
| `main` への直接 push | PR 経由が規約(`CLAUDE.md`) |
| force push(`--force-with-lease` は許可) | 他者のブランチ履歴の破壊を防ぐ |
| `drizzle-kit push` | DDL の手書き・スキーマ定義と DB 実体のずれを防ぐ(マイグレーションは `db:generate` の生成物のみ) |
| `.env` の読み出し(`cat` / `grep` / `source` 等。`.env.example` は対象外) | 認証情報が会話ログに平文で残るのを防ぐ |
| リポジトリルート・`packages/` への `rm -rf` | 取り返しのつかない削除を防ぐ |

`.env` は `settings.json` の `permissions.deny` で Read / Edit ツール側も塞いでいる。**シェル経由で読めては意味がない**ため、hook で二重に止めている(これは判定の二重化ではなく、同じ資産に対する別経路の封鎖)。

`stop-typecheck.mjs` は自身の差し戻しで再度呼ばれた場合に素通しする(`stop_hook_active` を見る)。無限ループを避けるため。

## 4. Routine(起動)

claude.ai の Claude Code → Routines から作成する定期実行。**fire ごとに fresh session** で、手元のセッションや PC の状態に依存しない。

| Routine | スケジュール(UTC) | 起動するもの | 運用の一次資料 |
| --- | --- | --- | --- |
| バックログ自動消化 | `1 */2 * * *`(2時間おき) | `/issue-work` 無人モード | [`backlog-routine.md`](../automation/backlog-routine.md) |
| PR 執事 | `10 */3 * * *`(3時間ごと) | `/pr-steward` | [`pr-steward-routine.md`](../automation/pr-steward-routine.md) |
| 振り返り | `0 0 * * 1`(週次・月曜 09:00 JST) | `/retro` | [`retro-routine.md`](../automation/retro-routine.md) |
| ドキュメント乖離検知 | `0 0 * * 3`(週次・水曜 09:00 JST) | `/docs-drift` | [`docs-drift-routine.md`](../automation/docs-drift-routine.md) |

スケジュールを散らしているのは、同時 fire による競合(コンフリクト修復の取り合い・候補ループの空振り)を避けるため。週次の2本を月曜と水曜に分けているのも同じ理由で、拾う関心事が独立しているため負荷を分散できる。

**バックログ Routine だけがマージを行う。** PR 執事は green にするところまでで、マージは次のバックログ fire の回収マージが拾う(マージゲートの定義を1箇所に保つため)。

## 5. Routine のプロンプトを薄く保つ

Routine のプロンプトには**手順を一切書かない**。書くのは「どのスキルを・どのモードで・何語で報告するか」だけ。

理由は更新経路の非対称性にある。

| やりたいこと | Claude(MCP `*_trigger` ツール)から | claude.ai の画面から |
| --- | --- | --- |
| cron・プロンプトの確認 | できる | できる |
| 画面で作った Routine の更新・停止 | **できない**(`created_via` の制約) | できる |
| Routine の新規作成 | 実質できない(リポジトリも MCP コネクタも引き継がれない) | できる |

つまり **Routine の更新は画面からしか行えない**。プロンプトに手順を書き込むと、手順を変えるたびに画面での貼り直しが必要になり、「skills は直したのに Routine は古いまま」という乖離が生まれる(2026-08-23 の自動マージ移行で実際に発生した)。

手順の正をすべて `SKILL.md` に置けば、**PR をマージした次の fire から新しい手順で動く**。貼り直しが要るのはスキル名・モード・報告言語を変えるときだけになる。

## 6. GitHub Actions

リポジトリ側で動く3ワークフロー。詳細は各一次資料へ。

| ワークフロー | 契機 | 役割 | 一次資料 |
| --- | --- | --- | --- |
| `ci.yml` | PR / `main` への push | `verify` ジョブ(変更パスでステップを出し分け)+ `main` 失敗時の `needs-decision` 起票 | `docs/review/README.md` §4 |
| `notify-needs-decision.yml` | Issue の labeled / PR の opened・closed | 判断待ちと PR 作成の**メール通知**、着手中ロックの自動解除、クローズされた PR に紐づく判断 Issue の自動クローズ | [02-labels.md](./02-labels.md) §3、`docs/automation/backlog-routine.md` |
| `pr-preview.yml` | `packages/web` を含む PR | モック起動モードの画面を GitHub Pages に配信し、URL を PR にコメント | [`pr-preview.md`](../automation/pr-preview.md) |

`pr-preview` のチェックは**マージを止めない**。配信は画面確認の補助であって検証の関門ではないため、配信(`deploy`)ジョブは `continue-on-error` で扱い、ブランチ保護の required check にも含めていない(required は `verify` のみ。`docs/review/README.md` §4)。
