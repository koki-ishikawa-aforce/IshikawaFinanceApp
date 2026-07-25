---
name: security-review
description: 変更差分をセキュリティ観点(署名検証・IDトークン検証・認可の位置・シークレット/PII 流出・外部入力の検証)でレビューする。API のルート・ミドルウェア・認証・外部連携(LINE / Gmail)を変更したときに使用する。
---

# セキュリティレビュー

変更差分を、割まるの外周(外部から到達できる境界)の攻撃面に照らしてレビューする。実際のレビューは `security-reviewer` サブエージェントが行う。

## 起動条件

`docs/review/README.md` §3 のトリガー表に従い、差分が以下を含む場合に起動する:

- `packages/api/src/routes/**`
- `packages/api/src/middleware/**`
- `packages/api/src/gmail-oauth/**`
- 認証・外部連携(LINE Messaging API / LIFF / Gmail)に関わる変更
- シークレット・トークンの取得・保管に関わる変更(`packages/api/src/aws/**` など)

## 責務分担

- **プライバシー3段階ルール**(相手ロールに何が見えるか)は `/ddd-review` の担当。本レビューは「そもそも認証・認可を通っているか」と「外周から入る/出るデータ」を見る
- **依存パッケージの既知脆弱性**は CI の `pnpm audit` が担保する(`docs/review/dependency-audit.md`)。本レビューでは扱わない

## 手順

1. `git diff main...HEAD --name-only` で変更範囲を確認し、上記の起動条件に該当するか判定する
2. `security-reviewer` サブエージェントを起動し、以下を渡す:
   - 変更ファイル一覧(またはレビュー対象の diff 範囲)
   - 関連する Issue 番号と受け入れ条件(あれば)
   - 差分がどの経路に属するか(LIFF `/api/*` / Gmail OAuth コールバック / LINE Webhook / 内部イベント処理)が分かっていれば添える
3. 新しいルートを追加した差分では、以下が漏れなくレビューされていることを確認する:
   - `packages/api/src/app.ts` で認証ミドルウェア配下に置かれているか
   - `/api/*` の外に置く場合、その経路が自前の署名検証・トークン検証を持っているか
4. レビュー結果を **must-fix** / **suggestion** に分けてユーザーに提示する
5. must-fix は必ず修正する。**suggestion も原則その場で修正する(デフォルトは対応)**。修正後は `/verify` を再実行して green を確認する
6. 例外として、以下のいずれかに該当する suggestion のみ見送ってよい:
   - 修正範囲が今回の diff を大きく超える(別リファクタリングが必要)
   - 設計判断の変更を伴い、ユーザーの意思決定が必要
7. 見送る suggestion は黙って放置せず、理由を添えてユーザーに提示したうえで GitHub Issue 化して追跡する(その場で `gh issue create` する。`needs-decision` を付けて `/decide` に接続する)

## 特に落とせない指摘

次の3つは、見落とすと家計の全明細が第三者に渡る。指摘が出た場合は suggestion であっても見送らない:

- ID トークンの `aud` 検証欠落(別チャネルのトークンで他人になりすませる)
- Webhook 署名検証の欠落・素通し(誰でも偽イベントを送れる)
- 開発用フォールバック(`X-User-Id` ヘッダーで任意のユーザーになれる `devViewerIdMiddleware`)が本番で有効になる経路
