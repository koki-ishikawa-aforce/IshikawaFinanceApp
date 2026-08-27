# ライフサイクル網羅表(SWEBOK v4 18 KA ベース)

工程の欠落(CD・設計工程など)が、これまでオーナーの気づきに頼らないと検出できなかった問題への恒久対策。ソフトウェア工学の知識体系全域を機械的に突合し、❌ 行がそのまま Issue 候補として毎回同じ形で浮かび上がる状態を作る。

**`docs/review/README.md` §2 との住み分け** — あちらは ISO/IEC 25010 を物差しにした**プロダクトの品質特性**(機能適合性・性能・信頼性…)の担保表。本書は SWEBOK v4 を物差しにした**開発ライフサイクルの工程そのもの**(要件〜設計〜実装〜検証〜運用〜保守)の担保表で、対象が異なる。プロダクト品質の担保状況を再掲しない(KA12「品質」行は §2 への参照のみ)。

採用の経緯・体系選定の根拠は [research/2026-08-27-lifecycle-frameworks.md](./research/2026-08-27-lifecycle-frameworks.md) を参照(12体系を比較し、SWEBOK v4 を背骨、AWS Well-Architected と OWASP SAMM を補助物差しに採用)。

## 1. 参照する体系の版数

| 体系 | 版 | 役割 |
| --- | --- | --- |
| SWEBOK(Guide to the Software Engineering Body of Knowledge) | v4.0(2024-10 released) | 背骨。18 知識領域(KA)で工程の網羅性を測る |
| AWS Well-Architected Framework | 6 本柱(2023 改訂版) | 運用・信頼性・セキュリティ行の補助物差し(ID 付き質問票) |
| OWASP SAMM(Software Assurance Maturity Model) | v2 | セキュリティ行の補助物差し(プラクティス名) |
| OWASP ASVS(Application Security Verification Standard) | 5.0(2025) | `/security-review` のチェック項目の中身を供給する層(本書では参照のみ) |
| DORA(DevOps Research and Assessment) | 2024/2025 | KA6(運用)の測り方。`docs/workflow/05-criteria.md` 基準11「到達性」の Four Keys と同一 |

版が動きやすい領域(OWASP LLM/Agentic Top 10 等)は、改訂のたびにこの表の版数も更新する。

## 2. 網羅表

判定の凡例: ✅ 担保済み / ⚠️ 部分的 / ❌ 未整備 / 対象外(基礎系 KA — このワークフローが工程として担保する性質のものではない)

| # | 知識領域(KA) | 担保手段 | 状態 | 備考 |
| --- | --- | --- | --- | --- |
| KA1 | Software Requirements(要件) | skill: `/issue-create`・`/backlog-ready`(ready 判定基準) | ✅ | 要件の起票から着手承認までが1つの skill 対で完結している([01-lifecycle.md](./01-lifecycle.md)) |
| KA2 | Software Architecture(アーキテクチャ) | docs: `docs/domain/07-bounded-contexts.md`・`09-aggregates.md`、`CLAUDE.md`(ヘキサゴナルの依存方向)<br>レビュー: `/ddd-review`(依存の向き・集約境界) | ⚠️ | **既知の欠落(c) 設計工程不在**: アーキテクチャ資料は実装後に整える順序になっており、要件と実装の間に設計工程が無い。対策として軽量設計工程 `/feature-design`(#736)・design-first 規約(#737・原則12)は導入済み。draft 段階の議論を残す仕組み(ADR 等)は依然として無い |
| KA3 | Software Design(設計) | レビュー: `/ddd-review`(集約・値オブジェクトの配置)、`DESIGN.md`(画面の見た目)、`docs/domain/wireframes/`(画面設計の一部) | ⚠️ | 同じく (c) の影響を受ける。新規画面にレイアウト仕様を要求する ready 基準の追加(#738)も未導入で、画面設計が着手承認の時点で担保されていない |
| KA4 | Software Construction(構築) | `packages/*/README.md`(命名規約)、CI: `pnpm build` / `pnpm lint` / `pnpm typecheck`、hooks(編集後の自動整形・差分 typecheck) | ✅ | [`docs/review/README.md` §4](../review/README.md) |
| KA5 | Software Testing(テスト) | CI: `pnpm test`・統合テスト・VRT・受入 E2E、レビュー: `/test-review` | ✅ | [`docs/review/README.md` §2・§4](../review/README.md) |
| KA6 | Software Engineering Operations(運用) | 未整備(CD 無し) | ❌ | **既知の欠落(a) CD 不在・(b) バックアップ未定義**。マージから先(本番反映・監視・障害回復)を測る基準が `05-criteria.md` 基準11「到達性」(❌)。補助物差し: AWS WA OPS 4/6/8(可観測性・デプロイ)・REL 9(バックアップ)・REL 13(DR)。測り方は DORA Four Keys(デプロイ頻度・リードタイム・変更失敗率・復旧時間)。関連 Issue #56・#57 |
| KA7 | Software Maintenance(保守) | skill: `/pr-steward`(PR 保守)・`/docs-drift`(乖離検知)、通常の Issue ベース修正フロー | ✅ | 不具合修正は新規要件と同じ経路(`/issue-create` → `/issue-work`)で流れ、保守専用の別工程を必要としない |
| KA8 | Software Configuration Management(構成管理) | Git ベースのブランチ運用、migration 生成規約(`packages/adapters-postgres/README.md`)、pnpm lockfile のコミット | ✅ | DDL 手書き禁止・PR 経由の変更のみという規律が構成管理そのものを担っている(`CLAUDE.md`) |
| KA9 | Software Engineering Management(管理) | ラベルの状態遷移([02-labels.md](./02-labels.md))、WIP 上限、バックログ管理(`/backlog-ready`) | ✅ | 進捗管理は GitHub Issue とラベルに一元化されている |
| KA10 | Software Engineering Process(プロセス) | 本 docs 群自体(工程定義)、`/retro` → `/decide`(プロセス改善ループ)、`05-criteria.md`(プロセス測定) | ⚠️ | **既知の欠落(e) 自動化自身の可観測性なし**: fire の実行結果が構造化記録として残らず、`/retro` は自由テキストの発掘に依存している(`05-criteria.md` 基準6)。対策として fire の構造化レポート(#740)が起票済み(未実装) |
| KA11 | Software Engineering Models and Methods(モデルと手法) | DDD・ヘキサゴナルアーキテクチャ、ユビキタス言語(`docs/domain/08a`〜`08h`) | ✅ | |
| KA12 | Software Quality(品質) | `docs/review/README.md` §2(ISO/IEC 25010 対応表)、レビュー群(`/ddd-review`・`/ui-review`・`/ux-review`・`/test-review`) | ✅ | 詳細は [`docs/review/README.md` §2](../review/README.md) を正とし、本書には複製しない(§1-3 の重複禁止) |
| KA13 | Software Security(セキュリティ) | CI: `pnpm audit`(依存脆弱性の検知)、レビュー: `/security-review` | ⚠️ | **既知の欠落(d) 依存更新の自動化なし・(f) シークレット混入検知なし**。CI は脆弱性を検知するが修復は人手([dependency-audit.md](../review/dependency-audit.md))。GitHub Secret Scanning は未設定。補助物差し: AWS WA SEC06-BP01(パッチ自動化)、OWASP SAMM v2 の Vulnerability Management(EM-B: Patching and Updating)・Secure Deployment(SD-B: Secret Management) |
| KA14 | Software Engineering Professional Practice(専門家としての実務) | `CLAUDE.md`「登場人物」表(主体ごとの権限境界)、プライバシー3段階ルール | ⚠️ | 行動境界の明文化はあるが、SWEBOK が定義する専門職倫理・コミュニケーション規範としての整理はされていない |
| KA15 | Software Engineering Economics(経済学) | 未整備 | ❌ | 着手承認(`ready-to-implement`)は人間の裁量のみで、費用対効果・優先順位付けの明文化された基準がない |
| KA16 | Computing Foundations(計算機科学基礎) | — | 対象外 | 基礎知識であり、ワークフローが工程として担保する対象ではない |
| KA17 | Mathematical Foundations(数学基礎) | — | 対象外 | 同上 |
| KA18 | Engineering Foundations(工学基礎) | — | 対象外 | 同上 |

## 3. この表の使い方と改訂

- **❌ 行はそのまま Issue 候補になる。** 新しい ❌ が見つかったら、設計判断を要するものは `[判断待ち]` + `needs-decision`、機械的に着手可能なものは通常の Issue として起票する
- **物差しは網であって神託ではない。** 全項目を ✅ にすることが目的ではなく、「対象外」「未整備のまま据え置く」という判断も明示的な記録として扱う(テーラリング)
- **定期的な突合は `/workflow-review`(四半期)が担う。** 本表自体は `/retro`(週次・失敗データ駆動)では更新されない — 動いていない工程は失敗データを生まないため、体系駆動の別レビューが必要という結論に基づく([research/2026-08-27-workflow-external-review.md](./research/2026-08-27-workflow-external-review.md) §2)
- 版数・状態を更新したら、根拠(どの Issue でどう変わったか)を備考列に残す
