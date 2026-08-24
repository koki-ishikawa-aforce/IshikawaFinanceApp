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
- **世帯の状態（シナリオ）の切り替え**: URL クエリ `?mockScenario=accounts-unregistered` で、
  別銀行貯蓄口座・NISA 口座が未登録の世帯になる（無指定は登録済みの `default`）。未登録のときだけ
  出る画面（設定 > 口座タブの「別銀行貯蓄口座を追加」「NISA口座を追加」）を再現するためのもので、
  口座に由来する fixture（口座一覧・残高一覧・残高鮮度・資産合計・資産推移・ダッシュボードの KPI）
  が揃って未登録の状態を返す。シナリオを足すときは `src/mocks/scenario.ts` に値を追加する。
- **「今」の固定**: 環境変数 `NEXT_PUBLIC_MOCK_NOW`（ISO 8601 の日時）を渡すと、画面が当月・
  今日として扱う日時がその値に固定される（`src/lib/now.ts`）。未指定なら端末の現在時刻のまま。
  月名・日付・「表示中の月が当月か」で見た目が変わる画面を、月が替わっても同じ見た目で撮るために使う
  （設定値は `playwright.config.ts` が正。詳細は「ビジュアルリグレッションテスト」の節）。
- **fixture の対象**: 用意済みの経路は `src/mocks/resolve.ts` の一覧が正。未定義のパスは実 API の
  404 相当を返す（画面はエラー状態を表示）。他画面を足すときは `src/mocks/fixtures.ts` に fixture を
  追加し、`src/mocks/resolve.ts` に経路を追加する。
- **通常ビルドへの影響**: モック分岐は `process.env.NEXT_PUBLIC_MOCK` の定数畳み込みで
  デッドコード除去され、`src/mocks/` は動的 import のため通常の `pnpm build` には読み込まれない。

### 静的ファイルとして書き出す

PR ごとの画面プレビュー配信（`docs/automation/pr-preview.md`）で使う。

```bash
pnpm --filter @warimaru/web build:mock
# = NEXT_PUBLIC_MOCK=1 next build → out/ に Static Export
```

- **サブパス配信**: `NEXT_PUBLIC_BASE_PATH=/<リポジトリ名>/pr-<番号>` を渡すと、その
  パス配下へ置ける成果物になる（Next.js の `basePath`）。未設定なら空文字で、通常の
  ビルド・ローカル開発・VRT の挙動は変わらない。
- **ロール・シナリオの保持**: `?mockRole=honey` や `?mockScenario=accounts-unregistered` で
  指定した値はタブ単位（`sessionStorage`）で保持される。クエリを持たない画面遷移やリロードの
  後もテーマとデータが食い違わない。

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

`e2e/visual-regression.spec.ts` が `e2e/screens.ts` の画面一覧 × 2テーマ（darling / honey）のスクリーンショット比較テストを実行する（一覧を 1 か所に置いているのは、画面を足すときに直す場所を分散させないため）。操作して初めて現れる画面（一括分類・遡及適用）は `e2e/classification-flows.spec.ts` が別に撮る。ベースライン画像は `e2e/__screenshots__/` に格納され、Git で管理する。

対象画面を足すときは `e2e/screens.ts` に 1 行足す。未登録・空といった特定の状態でしか出ない要素は、モック起動モードのシナリオ（`?mockScenario=`）を付けた URL を別の画面として並べる。

#### 日時と時間帯の固定

撮影中に画面が「今」として扱う日時（`NEXT_PUBLIC_MOCK_NOW`）と時間帯（`TZ` / Playwright の `timezoneId`）は `playwright.config.ts` で固定する（#506）。実時刻のままだと、月名や日付が写る画面（ホーム・取引一覧・レポート・取込・経費精算・残高）の基準画像が月が替わるたびにずれていき、そのずれが `maxDiffPixelRatio` の許容量に吸収されて緑のまま通る。日付と関係のない崩れも同じ許容量のぶんだけ一緒に見逃せる状態になるため、ずれ自体を無くしている。

- 固定日時は fixture（`src/mocks/`）が想定している「今」に合わせる。ここを別の月にすると、画面の見出しと中身が食い違ったものを基準画像として固定してしまう。fixture の月を動かすときは固定日時も一緒に動かし、基準画像を撮り直す
- 時間帯を固定するのは、日付の表示が端末の時間帯で決まるため。実行環境まかせにすると CI（UTC）と手元（JST）で違う日付の基準画像ができ、撮った環境と違う環境で赤くなる。値は利用者の時間帯である JST に揃える（ユニットテストの `vitest.config.ts` と同じ理由・同じ値）
- ブラウザと `next dev`（SSR）の双方へ同じ値を渡している。片方だけを固定すると初期 HTML とハイドレーション後で日付がずれる

#### ベースライン画像の更新手順

UI の意図的な変更でスクリーンショットが変わった場合は、ベースライン画像を更新する。

```bash
pnpm --filter @warimaru/web exec playwright test e2e/visual-regression.spec.ts --update-snapshots
```

更新後の画像を目視確認し、意図した差分のみであることを確かめてからコミットする。

#### CI での差分確認

CI（`.github/workflows/ci.yml`）でスクリーンショット比較に失敗した場合、差分画像が `playwright-test-results` アーティファクトとしてアップロードされる。GitHub Actions の Artifacts セクションからダウンロードして差分を確認できる。
