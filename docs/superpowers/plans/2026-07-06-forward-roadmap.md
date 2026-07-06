# これからの計画（Phase 4 完了後ロードマップ）

> 作成: 2026-07-06
> 前提: Phase 4 戦術的設計は完了（DoD 8 項目達成、`@warimaru/domain` 公開 API 確定）
> 親 spec: [Phase 4 戦術的設計](../specs/2026-05-01-phase4-tactical-design.md) §13–§14
> 現状レビュー: 2026-07-06 実施。build / typecheck / test (50件) / lint すべて green を確認済み

## 0. 現在地サマリ

| フェーズ | 内容 | 状態 |
|---|---|---|
| Phase 1–2 | ドメイン分析（イベントストーミング / シナリオ / UL / 集約定義） | ✅ 完了 |
| Phase 3 | 戦略的設計（境界づけられたコンテキスト + コンテキストマップ） | ✅ 完了 |
| Phase 3.5 | UX/UI 設計（ワイヤーフレーム 12 画面 / デザイントークン） | ✅ 完了 |
| Phase 4 | 戦術的設計 — Core 2 コンテキストの TS 型 + Zod + Repository/Query I/F | ✅ 完了 |
| Phase 4.5 | リポジトリ健全化（本計画 §1） | ✅ 完了（2026-07-06） |
| Phase 5 | 残りコンテキストの型化 + adapter 層 + web/api スケルトン | 🚧 M-A 完了（2026-07-06）、M-B / M-C 未着手 |
| Phase 6 | 実装統合・E2E・運用開始準備 | ⬜ 未着手 |

コード資産は `packages/domain`（`@warimaru/domain`）のみ。永続化・UI・API は未実装。

2026-07-06 確定事項:

- **アプリ名 = わりまる**（OQ-37。パッケージスコープも `@warimaru/*` に統一、OQ-45）
- **技術スタック = OQ-27 を正とする**（OQ-46）: Next.js (TS) Static Export + Hono on Lambda + Neon (PostgreSQL)

---

## 1. Phase 4.5: リポジトリ健全化（すぐ着手、半日規模）

Phase 5 の実装量が増える前に、機械的なチェックを固める。

- [x] **T-1 フォーマット差分の解消**: `pnpm format` を実行し、`pnpm format:check` を green にする
      （2026-07-06 時点で 9 ファイルが Prettier 未適用: `Account.ts` / `applyPrivacyFilter.ts` / テスト 6 ファイル / `packages/domain/README.md`）
- [x] **T-2 CI の導入**: GitHub Actions で PR ごとに `pnpm install --frozen-lockfile` → `build` → `typecheck` → `test` → `lint` → `format:check` を実行
      （DoD がローカル実行頼みである現状の唯一の構造的リスクを解消する → `.github/workflows/ci.yml`）
- [x] **T-3 OQ の棚卸し**: OQ-37〜45 を「Phase 5 前に確定 / Phase 5 中に確定 / 保留」に振り分け、
      [03-open-questions.md](../../domain/03-open-questions.md) §B を更新
  - ~~Phase 5 前に確定したいもの: OQ-37（アプリ名）~~ → **2026-07-06 確定: アプリ名 = わりまる**。
    OQ-45 も同時解決（パッケージ名を `@warimaru/domain` にリネーム済み）
  - Phase 5 中に確定するもの: OQ-38（SMBC URL 実調査）/ OQ-39（Flex Message サイズ検証）/ OQ-41（ID 生成方式）/ OQ-44（鮮度アラート閾値）
  - 実装を見て判断するもの: OQ-40（テーマ切替）/ OQ-42（イベント永続化）/ OQ-43（トランザクション境界）
  - 棚卸しで新規発見した **OQ-46**（OQ-27 と Phase 4 spec §13 の技術スタック記述の食い違い）→
    **2026-07-06 確定: OQ-27 を正とする**。スタック = Next.js (TS) Static Export + Hono on Lambda + Neon (PostgreSQL)。
    Phase 4 spec §13 の該当記述は修正済み。本ロードマップ §2 M-B / M-C も確定スタックで記述

### DoD（Phase 4.5）

- `pnpm format:check` を含む全ルートスクリプトが green
- main への PR で CI が自動実行される
- 03-open-questions.md §B に各 OQ の解決予定フェーズが明記されている

---

## 2. Phase 5: 残りコンテキストの型化 + adapter 層 + アプリスケルトン

親 spec §13.1 の引き継ぎ事項を 3 マイルストーンに分割する。**M-A → M-B → M-C の順に依存**する（M-B の Repository 実装は M-A の型を、M-C の画面は M-B の Query 実装を消費する）。

### M-A: 残り 6 コンテキストの型化（Phase 4 と同パターン）✅ 完了（2026-07-06）

> 実装 plan: [2026-07-06-phase5-m-a-context-typing.md](./2026-07-06-phase5-m-a-context-typing.md)

優先順は Core → Supporting → Generic:

- [x] 自動分類・学習（Core, 08b）
- [x] 経費精算（Core, 08e）
- [x] 取引取込（Supporting, 08a）
- [x] オンボーディング・認証（Supporting, 08f）— `nickname?` / 役割 `Honey | Darling` を反映
- [x] マスタ管理（Supporting, 08h）
- [x] 通知配信（Generic, 08g）

各コンテキストとも Phase 4 の確立パターンを踏襲する:
discriminated union 集約 + Zod superRefine 不変条件 + branded ID + Repository/Query I/F 分離 + View 型 + ドメインイベント型 + 不変条件テスト + 冒頭に DDD docs へのリンク。

### M-B: adapter 層の実装

永続化バックエンドは **Neon (PostgreSQL)** で確定済み（OQ-27 / OQ-46）。

- [ ] Neon 前提の DB スキーマ設計 spec を作成（テーブル設計、マイグレーション方式の選定）
- [ ] `packages/adapters-neon/` に Repository / Query の実装（まず家計分析 + 残高資産推移の 4 Repository / 5 Query）
- [ ] ID 生成方式の確定（OQ-41: ULID 推奨）と `idSchema` の正規表現強化
- [ ] ドメインイベントバス（家計内ツール規模なので in-process pub/sub から開始、OQ-42 はここで判断)

### M-C: アプリスケルトン

技術スタックは OQ-27 で確定済み: フロント = Next.js (TS) Static Export、バックエンド = Hono on Lambda、
配信 = S3 + CloudFront、シークレット = Parameter Store。

- [ ] `packages/web/`: Next.js (TS) Static Export + LIFF SDK、TanStack Query で Query I/F を消費、React Hook Form + Zod resolvers
- [ ] `packages/api/`: Hono on Lambda、Repository/Query adapter のワイヤリング
- [ ] ダッシュボード 1 画面（KPI 4 枚 + ドーナツチャート）を縦串で貫通させ、アーキテクチャを実証する

### DoD（Phase 5）

- 全 8 コンテキストが `@warimaru/domain` から export され、不変条件テストが green
- Neon (PostgreSQL) で Repository/Query の統合テストが green
- ダッシュボード画面が実データ（またはシード）で表示できる（縦串の貫通確認）
- OQ-38 / 39 / 41 / 44 がクローズされている

---

## 3. Phase 6: 実装統合・運用開始準備（アウトライン）

Phase 5 完了後に writing-plans で詳細化する。現時点では見通しのみ:

- 残り画面の実装（Phase 3.5 ワイヤーフレーム 12 画面）
- 取引取込の実運用パイプライン（CSV / Gmail 連携、OQ-38 の成果を反映)
- LINE 通知の実配信（OQ-39 の検証結果を反映)
- デプロイ（IaC）・監視・バックアップ方針
- テーマカラー対応の最終判断（OQ-40）

---

## 4. 進め方の約束事

- 各フェーズ着手前に superpowers:brainstorming → writing-plans で spec / plan を作成する（Phase 3〜4 と同じ運用）
- コミットは Phase 4 と同様に小さく分割し、コンテキスト単位で `feat(domain/<context>): ...` のプレフィックスを維持する
- 本ロードマップは各フェーズ完了時にチェックボックスと状態表を更新する
