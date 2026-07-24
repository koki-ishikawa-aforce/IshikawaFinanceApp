# @warimaru/web

わりまるのフロントエンド（Next.js 15 Static Export + React 19 + LIFF）。

## 通常の開発

```bash
pnpm --filter @warimaru/web dev
```

LIFF ID（`NEXT_PUBLIC_LIFF_ID`）が未設定のときは LIFF 認証をスキップして描画するが、
API（`NEXT_PUBLIC_API_URL`、既定 `http://localhost:3001`）への実アクセスが必要になる。

## モック起動モード（LIFF/API モック）

LIFF 認証も API サーバーも無しで画面を描画するモード。E2E テスト・スクリーンショット・
ビジュアルリグレッションの土台として使う。

```bash
pnpm --filter @warimaru/web dev:mock
# = NEXT_PUBLIC_MOCK=1 next dev --port 3000
```

- **有効化**: 環境変数 `NEXT_PUBLIC_MOCK=1`。このときだけ、API 呼び出し（`apiFetch` /
  `apiMutate`）が実ネットワークではなく固定 fixture（`src/mocks/`）を返す。
- **ロール／テーマの切り替え**: URL クエリ `?mockRole=honey` で honey テーマ、無指定または
  `?mockRole=darling` で darling テーマ。ロールは `/api/me` のモック応答経由でテーマに反映される。
- **fixture の対象**: 現状はダッシュボード（`/api/me`・`/api/dashboard/kpis`・
  `/api/dashboard/category-breakdown`）。未定義のパスは実 API の 404 相当を返す（画面はエラー状態を表示）。
  他画面を足すときは `src/mocks/fixtures.ts` に fixture を追加し、`src/mocks/resolve.ts` に経路を追加する。
- **通常ビルドへの影響**: モック分岐は `process.env.NEXT_PUBLIC_MOCK` の定数畳み込みで
  デッドコード除去され、`src/mocks/` は動的 import のため通常の `pnpm build` には読み込まれない。

## E2E テスト（Playwright）

モック起動モードの `next dev` を Playwright が自動で立ち上げてスモークテストを実行する。

```bash
pnpm --filter @warimaru/web test:e2e
```

- 設定は `playwright.config.ts`、テストは `e2e/` 配下（`*.spec.ts`）。
- ブラウザは実行環境にプリインストール済みの Chromium（`PLAYWRIGHT_BROWSERS_PATH`）を使う。
  ローカルで未インストールの場合のみ `pnpm --filter @warimaru/web exec playwright install chromium` を実行する。
- ユニットテスト（Vitest）は `src/**/*.test.{ts,tsx}` のみを対象にしており、`e2e/*.spec.ts` とは分離されている。

### ビジュアルリグレッションテスト

`e2e/visual-regression.spec.ts` が 6画面（dashboard / transactions / balances / reports / settings / onboarding）× 2テーマ（darling / honey）のスクリーンショット比較テストを実行する。ベースライン画像は `e2e/__screenshots__/` に格納され、Git で管理する。

#### ベースライン画像の更新手順

UI の意図的な変更でスクリーンショットが変わった場合は、ベースライン画像を更新する。

```bash
pnpm --filter @warimaru/web exec playwright test e2e/visual-regression.spec.ts --update-snapshots
```

更新後の画像を目視確認し、意図した差分のみであることを確かめてからコミットする。

#### CI での差分確認

CI（`.github/workflows/ci.yml`）でスクリーンショット比較に失敗した場合、差分画像が `playwright-test-results` アーティファクトとしてアップロードされる。GitHub Actions の Artifacts セクションからダウンロードして差分を確認できる。
