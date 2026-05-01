# ワイヤーフレームインデックス

> 親: [Phase 3.5 spec](../../superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md)

## 1. 保管場所

- ローカルセッション: `.superpowers/brainstorm/68872-1777617623/content/*.html`（gitignore 対象）
- 本リポジトリには直接コピーしない（HTML は Visual Companion 専用、本実装時は React/TSX で再構築）
- 確定した設計値は本ディレクトリの [`design-tokens.md`](./design-tokens.md) と spec 本体を参照

## 2. 画面 × spec マッピング

| # | 画面 | 該当 HTML | spec 該当節 |
|---|---|---|---|
| 1 | ダッシュボード（妻 v6 ピンク） | dashboard-pink-v9.html | §5 |
| 2 | ダッシュボード（夫 A3+ パステルスカイ） | dashboard-husband-a3-deeper.html | §5 |
| 3 | 世帯/個人切替プレビュー | dashboard-toggle-v1.html | §5.4 |
| 4 | ニックネーム反映プレビュー | honey-darling-v1.html | §3.3, §5 |
| 5 | ドリルダウン仕様 | drilldown-v1.html | §5.5 |
| 6 | 月次レポート画面 | monthly-report-v1.html | §6 |
| 7 | 取引一覧 + 編集モーダル A 案 | transaction-list-v1.html / transaction-modal-v2.html | §7 |
| 8 | 経費精算管理タブ | expense-tab-v1.html | §8 |
| 9 | 口座タブ + 個別詳細 | accounts-v1.html / accounts-v3-graphs.html | §9 |
| 10 | CSV/PDF 取込画面（取得 URL 案内付き） | csv-import-v3-guide.html | §10 |
| 11 | オンボーディング 4 Phase | onboarding-v1.html / honey-darling-v1.html (Phase 1) | §11 |
| 12 | LINE 通知 + Deep Link | notifications-v1.html | §12 |
| 13 | 設定（プロフィール / 口座管理） | nickname-v1.html / customization-v1.html | §13 |

## 3. 確定済み設計値（参照ハブ）

| 項目 | 参照先 |
|---|---|
| テーマカラー | [`design-tokens.md` §1](./design-tokens.md) |
| カテゴリ色 | [`design-tokens.md` §2](./design-tokens.md) |
| ロール名・ニックネーム | spec §3 |
| ナビゲーション（4 タブ） | spec §4 |
| ドリルダウン仕様（11 要素） | spec §5.5 |
| 状態バッジ（暫定/CSV確定/最終確定） | spec §6.2 |
| 取引編集モーダル A 案 | spec §7.4 |
| 時系列グラフ仕様（万単位） | spec §9.4 |
| LINE 通知 5 種 + Deep Link | spec §12 |

## 4. Phase 4 戦術設計が拾うべきポイント

- 各画面が要求する **データ契約**（どのフィールドがどの集約から来るか）→ spec §5/§6/§7
- **プライバシー 3 段階の実装位置**（ドメインサービス / リポジトリ / Read Model のいずれ）→ spec §17.1
- **集約の追加属性**（nickname / 銀行名 / 証券会社名）→ spec §14、08d / 08f / 09 で反映済
- **Deep Link URL パラメータ**（/import?month=YYYY-MM 等）→ spec §12.2
