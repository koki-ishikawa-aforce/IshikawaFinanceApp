# Phase 4 戦術的設計 実装プラン — Core 2 コンテキスト先行

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 4 spec で確定した家計分析・残高資産推移管理 2 コンテキストを `@household/domain` パッケージに TS + Zod で実装し、Phase 4 DoD 8 項目を全て green にする。

**Architecture:** pnpm workspace モノレポを新規構築し、`packages/domain/` に Zod スキーマ主体の集約・Repository I/F・Query I/F + View 型・プライバシーフィルタを配置する。CQRS 軽量分離（Write 側 = Repository、Read 側 = Query）でプライバシーは Read Model 層に集中させる。Vitest で不変条件と viewer × 所有者 × 費用区分マトリクスをテストする。

**Tech Stack:**
- パッケージマネージャ: pnpm 9
- 言語: TypeScript 5.4 (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)
- スキーマ: Zod 3.23
- テスト: Vitest 1.6
- Node: 20 LTS
- リンタ: ESLint 8 + @typescript-eslint 7
- フォーマッタ: Prettier 3.2

**親 spec:** [docs/superpowers/specs/2026-05-01-phase4-tactical-design.md](../specs/2026-05-01-phase4-tactical-design.md)

---

## ファイル構造（spec §3.2 を実装プラン用に再確認）

```
IshikawaFinanceApp/
├─ pnpm-workspace.yaml                          # Task 1
├─ package.json                                 # Task 1
├─ tsconfig.base.json                           # Task 1
├─ .nvmrc                                       # Task 1
├─ .prettierrc                                  # Task 3
├─ .eslintrc.cjs                                # Task 3
├─ .gitignore                                   # Task 1（追記）
└─ packages/
    └─ domain/
        ├─ package.json                         # Task 2
        ├─ tsconfig.json                        # Task 2
        ├─ tsconfig.test.json                   # Task 2
        ├─ vitest.config.ts                     # Task 2
        ├─ README.md                            # Task 33
        ├─ src/
        │   ├─ index.ts                         # Task 30
        │   ├─ shared/
        │   │   ├─ ids.ts                       # Task 4
        │   │   ├─ value-objects/
        │   │   │   ├─ Money.ts                 # Task 5
        │   │   │   ├─ YearMonth.ts             # Task 6
        │   │   │   ├─ ExpenseClass.ts          # Task 7
        │   │   │   └─ index.ts                 # Task 7
        │   │   ├─ events/
        │   │   │   └─ DomainEvent.ts           # Task 8
        │   │   ├─ errors/
        │   │   │   ├─ DomainError.ts           # Task 9
        │   │   │   └─ index.ts                 # Task 9
        │   │   └─ index.ts                     # Task 10
        │   ├─ household-analysis/
        │   │   ├─ value-objects/
        │   │   │   ├─ ImportSource.ts          # Task 11
        │   │   │   ├─ ClassificationBasis.ts   # Task 12
        │   │   │   └─ index.ts                 # Task 12
        │   │   ├─ aggregates/
        │   │   │   ├─ Transaction.ts           # Task 13
        │   │   │   ├─ MonthlyReport.ts         # Task 14
        │   │   │   └─ index.ts                 # Task 14
        │   │   ├─ repositories/
        │   │   │   ├─ TransactionRepository.ts # Task 15
        │   │   │   ├─ MonthlyReportRepository.ts # Task 15
        │   │   │   └─ index.ts                 # Task 15
        │   │   ├─ queries/
        │   │   │   ├─ views/
        │   │   │   │   ├─ DashboardKpisView.ts # Task 16
        │   │   │   │   ├─ CategoryBreakdownView.ts # Task 16
        │   │   │   │   ├─ MonthlyReportView.ts # Task 16
        │   │   │   │   ├─ TransactionListItem.ts # Task 16
        │   │   │   │   └─ index.ts             # Task 16
        │   │   │   ├─ DashboardQuery.ts        # Task 17
        │   │   │   ├─ MonthlyReportQuery.ts    # Task 17
        │   │   │   ├─ TransactionListQuery.ts  # Task 17
        │   │   │   └─ index.ts                 # Task 17
        │   │   ├─ privacy/
        │   │   │   ├─ ViewerContext.ts         # Task 18
        │   │   │   ├─ applyPrivacyFilter.ts    # Task 19
        │   │   │   └─ index.ts                 # Task 19
        │   │   ├─ events/
        │   │   │   ├─ MonthlyReportCsvConfirmed.ts # Task 20
        │   │   │   ├─ MonthlyReportFinalized.ts    # Task 20
        │   │   │   ├─ TransactionDeleted.ts        # Task 20
        │   │   │   └─ index.ts                     # Task 20
        │   │   └─ index.ts                     # Task 21
        │   └─ balance-asset-tracking/
        │       ├─ value-objects/
        │       │   ├─ BankName.ts              # Task 22
        │       │   ├─ BrokerageName.ts         # Task 22
        │       │   └─ index.ts                 # Task 22
        │       ├─ aggregates/
        │       │   ├─ Account.ts               # Task 23
        │       │   ├─ MitsuiSumitomoUnpaid.ts  # Task 24
        │       │   └─ index.ts                 # Task 24
        │       ├─ repositories/
        │       │   ├─ AccountRepository.ts     # Task 25
        │       │   ├─ MitsuiSumitomoUnpaidRepository.ts # Task 25
        │       │   └─ index.ts                 # Task 25
        │       ├─ queries/
        │       │   ├─ views/
        │       │   │   ├─ AccountBalanceListView.ts # Task 26
        │       │   │   ├─ BalanceTimeSeriesView.ts  # Task 26
        │       │   │   ├─ AssetTotalView.ts          # Task 26
        │       │   │   └─ index.ts                   # Task 26
        │       │   ├─ AccountBalanceQuery.ts   # Task 27
        │       │   ├─ BalanceTimeSeriesQuery.ts # Task 27
        │       │   └─ index.ts                 # Task 27
        │       ├─ events/
        │       │   ├─ AccountBalanceUpdated.ts # Task 28
        │       │   ├─ UnpaidBookkept.ts        # Task 28
        │       │   ├─ UnpaidSettled.ts         # Task 28
        │       │   ├─ NisaContributionAdded.ts # Task 28
        │       │   └─ index.ts                 # Task 28
        │       └─ index.ts                     # Task 29
        └─ tests/
            ├─ shared/
            │   ├─ value-objects/
            │   │   ├─ Money.test.ts            # Task 5
            │   │   └─ YearMonth.test.ts        # Task 6
            ├─ household-analysis/
            │   ├─ aggregates/
            │   │   ├─ Transaction.test.ts      # Task 13
            │   │   └─ MonthlyReport.test.ts    # Task 14
            │   └─ privacy/
            │       └─ applyPrivacyFilter.test.ts # Task 19
            └─ balance-asset-tracking/
                └─ aggregates/
                    ├─ Account.test.ts          # Task 23
                    └─ MitsuiSumitomoUnpaid.test.ts # Task 24
```

**Tasks 30-35** は統合・確認系（barrel 統合・README・全体検証）。

---

# Phase A: モノレポ基盤構築（Tasks 1-3）

## Task 1: pnpm workspace のルート構造を作成

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Modify: `.gitignore`

- [ ] **Step 1: pnpm-workspace.yaml を作成**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 2: ルート package.json を作成**

```json
{
  "name": "ishikawa-finance-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "prettier": "^3.2.0"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: tsconfig.base.json を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: .nvmrc を作成**

```
20
```

- [ ] **Step 5: .gitignore に Node.js 関連を追記**

既存の `.gitignore` の末尾に以下を追加:
```
# Node.js / pnpm
node_modules/
dist/
*.tsbuildinfo
.pnpm-debug.log*

# Vitest
coverage/

# Editor
.vscode/
.idea/
```

- [ ] **Step 6: pnpm install を実行して lockfile を生成**

Run: `pnpm install`
Expected: `pnpm-lock.yaml` が生成され、`node_modules/` にルート devDependencies (typescript, prettier) がインストールされる。エラーなし。

- [ ] **Step 7: コミット**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .nvmrc .gitignore pnpm-lock.yaml
git commit -m "feat(monorepo): pnpm workspace のルート構造を初期化"
```

---

## Task 2: packages/domain パッケージを初期化

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/tsconfig.test.json`
- Create: `packages/domain/vitest.config.ts`
- Create: `packages/domain/src/index.ts`（仮の空 export）

- [ ] **Step 1: packages/domain/package.json を作成**

```json
{
  "name": "@household/domain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.test.json",
    "lint": "eslint src tests --ext .ts"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: packages/domain/tsconfig.json を作成**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 3: packages/domain/tsconfig.test.json を作成**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": false,
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: packages/domain/vitest.config.ts を作成**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
    },
  },
})
```

- [ ] **Step 5: 仮の packages/domain/src/index.ts を作成**

```ts
// Phase 4 公開 API は Task 30 で完成させる
export {}
```

- [ ] **Step 6: pnpm install を実行**

Run: `pnpm install`
Expected: `packages/domain/node_modules/` に zod, vitest がインストールされる。エラーなし。

- [ ] **Step 7: typecheck を実行して通ることを確認**

Run: `pnpm -r typecheck`
Expected: エラーなし。

- [ ] **Step 8: build を実行して通ることを確認**

Run: `pnpm -r build`
Expected: `packages/domain/dist/index.js` と `index.d.ts` が生成される。

- [ ] **Step 9: コミット**

```bash
git add packages/domain/ pnpm-lock.yaml
git commit -m "feat(domain): @household/domain パッケージを初期化"
```

---

## Task 3: ESLint + Prettier 設定

**Files:**
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `.eslintrc.cjs`（ルート）
- Modify: `package.json`（lint スクリプトと依存追加）
- Create: `packages/domain/.eslintrc.cjs`

- [ ] **Step 1: .prettierrc を作成**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "avoid"
}
```

- [ ] **Step 2: .prettierignore を作成**

```
node_modules
dist
coverage
pnpm-lock.yaml
*.tsbuildinfo
docs/
.superpowers/
samples/
```

- [ ] **Step 3: ルートに ESLint 依存を追加**

ルート `package.json` の devDependencies に追記:
```json
{
  "devDependencies": {
    "typescript": "^5.4.0",
    "prettier": "^3.2.0",
    "eslint": "^8.57.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0"
  }
}
```

- [ ] **Step 4: ルート .eslintrc.cjs を作成**

```js
module.exports = {
  root: true,
  ignorePatterns: ['node_modules', 'dist', 'coverage', '*.tsbuildinfo'],
}
```

- [ ] **Step 5: packages/domain/.eslintrc.cjs を作成**

```js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.test.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  rules: {
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-non-null-assertion': 'error',
  },
}
```

- [ ] **Step 6: pnpm install で ESLint を取得**

Run: `pnpm install`
Expected: `node_modules` に eslint と関連パッケージがインストールされる。

- [ ] **Step 7: lint と format チェックを実行**

Run: `pnpm format:check && pnpm -r lint`
Expected: フォーマット差分なし、lint エラーなし（src/index.ts は空 export のみ）。

- [ ] **Step 8: コミット**

```bash
git add .prettierrc .prettierignore .eslintrc.cjs packages/domain/.eslintrc.cjs package.json pnpm-lock.yaml
git commit -m "feat(monorepo): ESLint + Prettier 設定を追加"
```

---

# Phase B: 共有レイヤ（Tasks 4-10）

## Task 4: branded ID 型（shared/ids.ts）

**Files:**
- Create: `packages/domain/src/shared/ids.ts`

- [ ] **Step 1: ids.ts を作成**

```ts
/**
 * Branded ID 型一式
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.1
 *
 * Phase 4 では永続化バックエンド未確定のため、ID 形式は最小限のチェックのみ。
 * Phase 5 で ULID 等の正規表現に強化する余地あり（OQ-41）。
 */
import { z } from 'zod'

const idSchema = z.string().min(1)

export const TransactionIdSchema = idSchema.brand<'TransactionId'>()
export type TransactionId = z.infer<typeof TransactionIdSchema>

export const UserIdSchema = idSchema.brand<'UserId'>()
export type UserId = z.infer<typeof UserIdSchema>

export const CategoryIdSchema = idSchema.brand<'CategoryId'>()
export type CategoryId = z.infer<typeof CategoryIdSchema>

export const ExpenseTypeIdSchema = idSchema.brand<'ExpenseTypeId'>()
export type ExpenseTypeId = z.infer<typeof ExpenseTypeIdSchema>

export const AccountIdSchema = idSchema.brand<'AccountId'>()
export type AccountId = z.infer<typeof AccountIdSchema>

export const MitsuiSumitomoUnpaidIdSchema = idSchema.brand<'MitsuiSumitomoUnpaidId'>()
export type MitsuiSumitomoUnpaidId = z.infer<typeof MitsuiSumitomoUnpaidIdSchema>

export const UnpaidEntryIdSchema = idSchema.brand<'UnpaidEntryId'>()
export type UnpaidEntryId = z.infer<typeof UnpaidEntryIdSchema>

export const MonthlyReportIdSchema = idSchema.brand<'MonthlyReportId'>()
export type MonthlyReportId = z.infer<typeof MonthlyReportIdSchema>

export const ExpenseReimbursementIdSchema = idSchema.brand<'ExpenseReimbursementId'>()
export type ExpenseReimbursementId = z.infer<typeof ExpenseReimbursementIdSchema>

export const SettlementNoticeIdSchema = idSchema.brand<'SettlementNoticeId'>()
export type SettlementNoticeId = z.infer<typeof SettlementNoticeIdSchema>

export const GmailMessageIdSchema = idSchema.brand<'GmailMessageId'>()
export type GmailMessageId = z.infer<typeof GmailMessageIdSchema>
```

- [ ] **Step 2: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add packages/domain/src/shared/ids.ts
git commit -m "feat(domain/shared): branded ID 型を追加"
```

---

## Task 5: Money 値オブジェクト

**Files:**
- Create: `packages/domain/src/shared/value-objects/Money.ts`
- Create: `packages/domain/tests/shared/value-objects/Money.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/domain/tests/shared/value-objects/Money.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { MoneySchema, money, addMoney, subtractMoney } from '../../../src/shared/value-objects/Money'

describe('Money', () => {
  it('整数を受け入れる', () => {
    expect(() => money(1000)).not.toThrow()
    expect(() => money(0)).not.toThrow()
    expect(() => money(-500)).not.toThrow()  // 返金等で負の値も許容
  })

  it('小数を拒否する', () => {
    expect(() => money(100.5)).toThrow()
  })

  it('Infinity / NaN を拒否する', () => {
    expect(() => money(Infinity)).toThrow()
    expect(() => money(NaN)).toThrow()
  })

  it('addMoney は 2 つの Money を加算する', () => {
    expect(addMoney(money(1000), money(500))).toBe(1500)
  })

  it('subtractMoney は 2 つの Money を減算する', () => {
    expect(subtractMoney(money(1000), money(300))).toBe(700)
  })

  it('Schema は branded 型を返す', () => {
    const m = MoneySchema.parse(100)
    expect(typeof m).toBe('number')
    expect(m).toBe(100)
  })
})
```

- [ ] **Step 2: テストの失敗を確認**

Run: `pnpm --filter @household/domain test Money`
Expected: FAIL — Money.ts が存在しない。

- [ ] **Step 3: Money.ts を作成**

`packages/domain/src/shared/value-objects/Money.ts`:
```ts
/**
 * Money 値オブジェクト（日本円・整数）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.2
 *
 * kawasima: data 金額 = 整数
 */
import { z } from 'zod'

export const MoneySchema = z.number().int().finite().brand<'Money'>()
export type Money = z.infer<typeof MoneySchema>

export function money(value: number): Money {
  return MoneySchema.parse(value)
}

export function addMoney(a: Money, b: Money): Money {
  return money(a + b)
}

export function subtractMoney(a: Money, b: Money): Money {
  return money(a - b)
}
```

- [ ] **Step 4: テストの成功を確認**

Run: `pnpm --filter @household/domain test Money`
Expected: PASS（6 件）。

- [ ] **Step 5: コミット**

```bash
git add packages/domain/src/shared/value-objects/Money.ts packages/domain/tests/shared/value-objects/Money.test.ts
git commit -m "feat(domain/shared): Money 値オブジェクトを追加"
```

---

## Task 6: YearMonth 値オブジェクト

**Files:**
- Create: `packages/domain/src/shared/value-objects/YearMonth.ts`
- Create: `packages/domain/tests/shared/value-objects/YearMonth.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/domain/tests/shared/value-objects/YearMonth.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { YearMonthSchema, yearMonth, previousMonth } from '../../../src/shared/value-objects/YearMonth'

describe('YearMonth', () => {
  it('YYYY-MM 形式を受け入れる', () => {
    expect(() => YearMonthSchema.parse('2026-05')).not.toThrow()
    expect(() => YearMonthSchema.parse('2026-12')).not.toThrow()
    expect(() => YearMonthSchema.parse('2026-01')).not.toThrow()
  })

  it('不正フォーマットを拒否する', () => {
    expect(() => YearMonthSchema.parse('2026-5')).toThrow()
    expect(() => YearMonthSchema.parse('2026-13')).toThrow()
    expect(() => YearMonthSchema.parse('2026-00')).toThrow()
    expect(() => YearMonthSchema.parse('26-05')).toThrow()
    expect(() => YearMonthSchema.parse('2026/05')).toThrow()
  })

  it('yearMonth(2026, 5) は "2026-05" を返す', () => {
    expect(yearMonth(2026, 5)).toBe('2026-05')
  })

  it('yearMonth(2026, 12) は "2026-12" を返す', () => {
    expect(yearMonth(2026, 12)).toBe('2026-12')
  })

  it('previousMonth は前月を返す', () => {
    expect(previousMonth(yearMonth(2026, 5))).toBe('2026-04')
  })

  it('previousMonth は 1 月から前年 12 月に繰り下がる', () => {
    expect(previousMonth(yearMonth(2026, 1))).toBe('2025-12')
  })

  it('previousMonth(_, 5) は 5 ヶ月前を返す', () => {
    expect(previousMonth(yearMonth(2026, 5), 5)).toBe('2025-12')
  })

  it('previousMonth(_, 12) は前年同月を返す', () => {
    expect(previousMonth(yearMonth(2026, 5), 12)).toBe('2025-05')
  })
})
```

- [ ] **Step 2: テストの失敗を確認**

Run: `pnpm --filter @household/domain test YearMonth`
Expected: FAIL — YearMonth.ts が存在しない。

- [ ] **Step 3: YearMonth.ts を作成**

`packages/domain/src/shared/value-objects/YearMonth.ts`:
```ts
/**
 * YearMonth 値オブジェクト（"YYYY-MM" 形式）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.2
 */
import { z } from 'zod'

export const YearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 形式である必要があります')
  .brand<'YearMonth'>()
export type YearMonth = z.infer<typeof YearMonthSchema>

export function yearMonth(year: number, month: number): YearMonth {
  const mm = String(month).padStart(2, '0')
  return YearMonthSchema.parse(`${year}-${mm}`)
}

export function previousMonth(ym: YearMonth, count = 1): YearMonth {
  const parts = ym.split('-').map(Number)
  const y = parts[0]
  const m = parts[1]
  if (y === undefined || m === undefined) {
    throw new Error(`Invalid YearMonth: ${ym}`)
  }
  let year = y
  let month = m
  for (let i = 0; i < count; i++) {
    if (month === 1) {
      year -= 1
      month = 12
    } else {
      month -= 1
    }
  }
  return yearMonth(year, month)
}
```

- [ ] **Step 4: テストの成功を確認**

Run: `pnpm --filter @household/domain test YearMonth`
Expected: PASS（8 件）。

- [ ] **Step 5: コミット**

```bash
git add packages/domain/src/shared/value-objects/YearMonth.ts packages/domain/tests/shared/value-objects/YearMonth.test.ts
git commit -m "feat(domain/shared): YearMonth 値オブジェクトを追加"
```

---

## Task 7: ExpenseClass enum と value-objects barrel

**Files:**
- Create: `packages/domain/src/shared/value-objects/ExpenseClass.ts`
- Create: `packages/domain/src/shared/value-objects/index.ts`

- [ ] **Step 1: ExpenseClass.ts を作成**

```ts
/**
 * 費用区分 enum
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.2
 *
 * kawasima: data 費用区分 = 世帯 OR 個人(夫) OR 個人(妻) OR 経費(会社)
 *
 * Honey/Darling の対応は Phase 3.5 で確定:
 * - personal_honey  = 夫
 * - personal_darling = 妻
 */
import { z } from 'zod'

export const ExpenseClassSchema = z.enum([
  'household',
  'personal_honey',
  'personal_darling',
  'business_expense',
])
export type ExpenseClass = z.infer<typeof ExpenseClassSchema>
```

- [ ] **Step 2: value-objects/index.ts barrel を作成**

```ts
export * from './Money'
export * from './YearMonth'
export * from './ExpenseClass'
```

- [ ] **Step 3: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add packages/domain/src/shared/value-objects/ExpenseClass.ts packages/domain/src/shared/value-objects/index.ts
git commit -m "feat(domain/shared): ExpenseClass enum と value-objects barrel を追加"
```

---

## Task 8: ドメインイベント基底（shared/events/DomainEvent.ts）

**Files:**
- Create: `packages/domain/src/shared/events/DomainEvent.ts`

- [ ] **Step 1: DomainEvent.ts を作成**

```ts
/**
 * ドメインイベント基底
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.3
 *
 * Phase 4 では型定義のみ。実配信（イベントバス）は Phase 5 以降。
 */
import { z } from 'zod'

export const DomainEventBaseSchema = z.object({
  eventId: z.string().min(1),
  occurredAt: z.date(),
})
export type DomainEventBase = z.infer<typeof DomainEventBaseSchema>
```

- [ ] **Step 2: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add packages/domain/src/shared/events/DomainEvent.ts
git commit -m "feat(domain/shared): ドメインイベント基底を追加"
```

---

## Task 9: エラー型階層（shared/errors/）

**Files:**
- Create: `packages/domain/src/shared/errors/DomainError.ts`
- Create: `packages/domain/src/shared/errors/index.ts`

- [ ] **Step 1: DomainError.ts を作成**

```ts
/**
 * ドメインエラー型階層
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.4
 *
 * ポリシー:
 *  - Repository.findById は「見つからない」を Promise<T | null> で表現し throw しない
 *  - 集約の状態遷移が不変条件違反 → InvariantViolationError を throw
 *  - Query で明示的な権限拒否 → PermissionDeniedError を throw
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class InvariantViolationError extends DomainError {}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`)
  }
}

export class PermissionDeniedError extends DomainError {}
```

- [ ] **Step 2: errors/index.ts を作成**

```ts
export * from './DomainError'
```

- [ ] **Step 3: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add packages/domain/src/shared/errors/
git commit -m "feat(domain/shared): エラー型階層を追加"
```

---

## Task 10: shared/index.ts barrel

**Files:**
- Create: `packages/domain/src/shared/index.ts`

- [ ] **Step 1: shared/index.ts を作成**

```ts
export * from './ids'
export * from './value-objects'
export * from './events/DomainEvent'
export * from './errors'
```

- [ ] **Step 2: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add packages/domain/src/shared/index.ts
git commit -m "feat(domain/shared): shared レイヤの barrel を追加"
```

---

# Phase C: 家計分析コンテキスト（Tasks 11-21）

## Task 11: ImportSource 値オブジェクト

**Files:**
- Create: `packages/domain/src/household-analysis/value-objects/ImportSource.ts`

- [ ] **Step 1: ImportSource.ts を作成**

```ts
/**
 * 取込ソース（取引がどこから取り込まれたか）
 * @see docs/domain/08c-ul-家計分析.md §1
 *
 * kawasima: data 取込ソース = メール由来 OR CSV由来 OR PDF由来 OR Amazon突合由来 OR 手動入力由来 OR CSV手動マージ由来
 */
import { z } from 'zod'
import { GmailMessageIdSchema, UserIdSchema, TransactionIdSchema } from '../../shared/ids'

export const ImportSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('email'),
    gmailMessageId: GmailMessageIdSchema,
  }),
  z.object({
    kind: z.literal('csv'),
    csvFileId: z.string().min(1),
    rowNumber: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('pdf'),
    pdfFileId: z.string().min(1),
    pageNumber: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('amazon_match'),
    smbcGmailMessageId: GmailMessageIdSchema,
    amazonOrderId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('manual'),
    enteredAt: z.date(),
    enteredByUserId: UserIdSchema,
  }),
  z.object({
    kind: z.literal('csv_merge'),
    originalTransactionId: TransactionIdSchema,
    mergedAt: z.date(),
  }),
])
export type ImportSource = z.infer<typeof ImportSourceSchema>
```

- [ ] **Step 2: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add packages/domain/src/household-analysis/value-objects/ImportSource.ts
git commit -m "feat(domain/household-analysis): ImportSource 値オブジェクトを追加"
```

---

## Task 12: ClassificationBasis 値オブジェクト + value-objects barrel

**Files:**
- Create: `packages/domain/src/household-analysis/value-objects/ClassificationBasis.ts`
- Create: `packages/domain/src/household-analysis/value-objects/index.ts`

- [ ] **Step 1: ClassificationBasis.ts を作成**

```ts
/**
 * 分類根拠（分類済み取引がどのルートで分類されたか）
 * @see docs/domain/08c-ul-家計分析.md §1
 *
 * kawasima: data 分類根拠 = 加盟店ルール根拠 OR Amazon商品キー根拠 OR ユーザー手動修正根拠 OR CSV取込時一括分類根拠
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'

export const ClassificationBasisSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('merchant_rule'),
    merchantName: z.string().min(1),
    ruleLastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('amazon_product_key'),
    amazonProductKey: z.string().min(1),
    ruleLastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('user_manual'),
    modifiedByUserId: UserIdSchema,
    modifiedAt: z.date(),
  }),
  z.object({
    kind: z.literal('csv_bulk'),
    bulkSessionId: z.string().min(1),
    appliedAt: z.date(),
  }),
])
export type ClassificationBasis = z.infer<typeof ClassificationBasisSchema>
```

- [ ] **Step 2: value-objects/index.ts を作成**

```ts
export * from './ImportSource'
export * from './ClassificationBasis'
```

- [ ] **Step 3: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add packages/domain/src/household-analysis/value-objects/
git commit -m "feat(domain/household-analysis): ClassificationBasis と value-objects barrel を追加"
```

---

## Task 13: Transaction 集約 + 不変条件テスト

**Files:**
- Create: `packages/domain/src/household-analysis/aggregates/Transaction.ts`
- Create: `packages/domain/tests/household-analysis/aggregates/Transaction.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/domain/tests/household-analysis/aggregates/Transaction.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  TransactionSchema,
  type CommonTransactionAttrs,
  type ClassifiedDetails,
} from '../../../src/household-analysis/aggregates/Transaction'

const validCommon: CommonTransactionAttrs = {
  transactionId: 'tx_001' as never,
  ownerUserId: 'user_honey' as never,
  merchantName: 'スーパーA',
  amount: 1500 as never,
  occurredAt: new Date('2026-05-01T12:00:00Z'),
  importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: 'user_honey' as never },
}

describe('Transaction 集約', () => {
  describe('未分類取引', () => {
    it('正常な未分類取引を parse できる', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'unclassified',
          common: validCommon,
          reason: 'merchant_rule_unlearned',
          defaultExpenseClass: 'personal_honey',
        }),
      ).not.toThrow()
    })

    it('reason が enum 外なら拒否', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'unclassified',
          common: validCommon,
          reason: 'unknown_reason',
          defaultExpenseClass: 'personal_honey',
        }),
      ).toThrow()
    })
  })

  describe('分類済み取引（不変条件）', () => {
    it('経費(会社) なら expenseTypeRef.kind = business が必須', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'classified',
          common: validCommon,
          details: {
            categoryId: 'cat_001' as never,
            expenseClass: 'business_expense',
            expenseTypeRef: { kind: 'non_business' },
            basis: { kind: 'user_manual', modifiedByUserId: 'user_honey' as never, modifiedAt: new Date() },
          },
        }),
      ).toThrow()
    })

    it('世帯費用に expenseTypeRef.kind = business は NG', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'classified',
          common: validCommon,
          details: {
            categoryId: 'cat_001' as never,
            expenseClass: 'household',
            expenseTypeRef: { kind: 'business', expenseTypeId: 'exp_001' as never },
            basis: { kind: 'user_manual', modifiedByUserId: 'user_honey' as never, modifiedAt: new Date() },
          },
        }),
      ).toThrow()
    })

    it('経費(会社) + business expenseTypeRef は OK', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'classified',
          common: validCommon,
          details: {
            categoryId: 'cat_001' as never,
            expenseClass: 'business_expense',
            expenseTypeRef: { kind: 'business', expenseTypeId: 'exp_001' as never },
            basis: { kind: 'user_manual', modifiedByUserId: 'user_honey' as never, modifiedAt: new Date() },
          },
        }),
      ).not.toThrow()
    })

    it('世帯費用 + non_business expenseTypeRef は OK', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'classified',
          common: validCommon,
          details: {
            categoryId: 'cat_001' as never,
            expenseClass: 'household',
            expenseTypeRef: { kind: 'non_business' },
            basis: { kind: 'merchant_rule', merchantName: 'スーパーA', ruleLastUpdatedAt: new Date() },
          },
        }),
      ).not.toThrow()
    })
  })

  describe('削除済み取引', () => {
    it('正常な削除済み取引を parse できる', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'deleted',
          common: validCommon,
          deletedAt: new Date(),
          deletionReason: 'user_deleted',
        }),
      ).not.toThrow()
    })
  })
})
```

- [ ] **Step 2: テストの失敗を確認**

Run: `pnpm --filter @household/domain test Transaction`
Expected: FAIL — Transaction.ts が存在しない。

- [ ] **Step 3: Transaction.ts を作成**

`packages/domain/src/household-analysis/aggregates/Transaction.ts`:
```ts
/**
 * 取引集約（家計分析コンテキスト）
 * @see docs/domain/08c-ul-家計分析.md §1
 * @see docs/domain/09-aggregates.md #7
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.1
 *
 * kawasima: data 取引 = 未分類取引 OR 分類済み取引 OR 削除済み取引
 *
 * 不変条件:
 *  - 経費(会社) 取引は経費種別ID 必須
 *  - 削除済み取引は変更不可（型遷移として表現、deleted → 他状態への関数を提供しない）
 */
import { z } from 'zod'
import {
  TransactionIdSchema,
  UserIdSchema,
  CategoryIdSchema,
  ExpenseTypeIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { ImportSourceSchema } from '../value-objects/ImportSource'
import { ClassificationBasisSchema } from '../value-objects/ClassificationBasis'

/** 共通取引属性 */
export const CommonTransactionAttrsSchema = z.object({
  transactionId: TransactionIdSchema,
  ownerUserId: UserIdSchema,
  merchantName: z.string().min(1),
  amount: MoneySchema,
  occurredAt: z.date(),
  importSource: ImportSourceSchema,
})
export type CommonTransactionAttrs = z.infer<typeof CommonTransactionAttrsSchema>

/** 未分類理由 */
export const UnclassifiedReasonSchema = z.enum([
  'merchant_rule_unlearned',
  'amazon_product_key_unlearned',
  'amazon_product_info_undecidable',
  'amazon_match_timeout',
  'learning_disabled',
])
export type UnclassifiedReason = z.infer<typeof UnclassifiedReasonSchema>

/** デフォルト費用区分（未分類取引の暫定区分） */
export const DefaultExpenseClassSchema = z.enum(['personal_honey', 'personal_darling'])
export type DefaultExpenseClass = z.infer<typeof DefaultExpenseClassSchema>

/** 経費種別参照: 経費(会社)取引なら経費種別ID 必須 */
export const ExpenseTypeRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('business'), expenseTypeId: ExpenseTypeIdSchema }),
  z.object({ kind: z.literal('non_business') }),
])
export type ExpenseTypeRef = z.infer<typeof ExpenseTypeRefSchema>

/** 分類済み取引固有データ */
export const ClassifiedDetailsSchema = z.object({
  categoryId: CategoryIdSchema,
  expenseClass: ExpenseClassSchema,
  expenseTypeRef: ExpenseTypeRefSchema,
  basis: ClassificationBasisSchema,
})
export type ClassifiedDetails = z.infer<typeof ClassifiedDetailsSchema>

/** 削除理由 */
export const DeletionReasonSchema = z.enum([
  'user_deleted',
  'merge_absorbed',
  'refund_match_absorbed',
])
export type DeletionReason = z.infer<typeof DeletionReasonSchema>

/** 取引（discriminated union） */
export const TransactionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('unclassified'),
    common: CommonTransactionAttrsSchema,
    reason: UnclassifiedReasonSchema,
    defaultExpenseClass: DefaultExpenseClassSchema,
  }),
  z
    .object({
      kind: z.literal('classified'),
      common: CommonTransactionAttrsSchema,
      details: ClassifiedDetailsSchema,
    })
    .superRefine((tx, ctx) => {
      // 不変条件: 経費(会社) → expenseTypeRef.kind = business
      if (
        tx.details.expenseClass === 'business_expense' &&
        tx.details.expenseTypeRef.kind !== 'business'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '経費(会社) 取引は expenseTypeRef.kind = business が必須',
          path: ['details', 'expenseTypeRef'],
        })
      }
      // 逆方向: 経費(会社) 以外 → expenseTypeRef.kind = non_business
      if (
        tx.details.expenseClass !== 'business_expense' &&
        tx.details.expenseTypeRef.kind === 'business'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '経費(会社) 以外の取引は expenseTypeRef.kind = non_business である必要がある',
          path: ['details', 'expenseTypeRef'],
        })
      }
    }),
  z.object({
    kind: z.literal('deleted'),
    common: CommonTransactionAttrsSchema,
    deletedAt: z.date(),
    deletionReason: DeletionReasonSchema,
  }),
])
export type Transaction = z.infer<typeof TransactionSchema>

export type UnclassifiedTransaction = Extract<Transaction, { kind: 'unclassified' }>
export type ClassifiedTransaction = Extract<Transaction, { kind: 'classified' }>
export type DeletedTransaction = Extract<Transaction, { kind: 'deleted' }>

/** 取引生成（不正データは ZodError を throw） */
export function createTransaction(input: unknown): Transaction {
  return TransactionSchema.parse(input)
}

/** 状態遷移: 未分類 → 分類済み */
export function classify(
  unclassified: UnclassifiedTransaction,
  details: ClassifiedDetails,
): ClassifiedTransaction {
  return TransactionSchema.parse({
    kind: 'classified',
    common: unclassified.common,
    details,
  }) as ClassifiedTransaction
}

/** 状態遷移: 未分類 or 分類済み → 削除済み */
export function deleteTransaction(
  tx: UnclassifiedTransaction | ClassifiedTransaction,
  reason: DeletionReason,
  at: Date,
): DeletedTransaction {
  return TransactionSchema.parse({
    kind: 'deleted',
    common: tx.common,
    deletedAt: at,
    deletionReason: reason,
  }) as DeletedTransaction
}
```

- [ ] **Step 4: テストの成功を確認**

Run: `pnpm --filter @household/domain test Transaction`
Expected: PASS（7 件）。

- [ ] **Step 5: コミット**

```bash
git add packages/domain/src/household-analysis/aggregates/Transaction.ts packages/domain/tests/household-analysis/aggregates/Transaction.test.ts
git commit -m "feat(domain/household-analysis): Transaction 集約と不変条件テストを追加"
```

---

## Task 14: MonthlyReport 集約 + 不変条件テスト + aggregates barrel

**Files:**
- Create: `packages/domain/src/household-analysis/aggregates/MonthlyReport.ts`
- Create: `packages/domain/src/household-analysis/aggregates/index.ts`
- Create: `packages/domain/tests/household-analysis/aggregates/MonthlyReport.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/domain/tests/household-analysis/aggregates/MonthlyReport.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  MonthlyReportSchema,
  finalize,
  type CsvConfirmedReport,
} from '../../../src/household-analysis/aggregates/MonthlyReport'

const baseCommon = {
  monthlyReportId: 'rep_001' as never,
  targetYearMonth: '2026-04' as never,
  householdCategoryTotals: [],
  personalTotalHoney: 0 as never,
  personalTotalDarling: 0 as never,
  businessExpenseTotalHoney: 0 as never,
  businessExpenseTotalDarling: 0 as never,
  nisaContributionAccumulated: 0 as never,
  balanceTrend: {
    smbcBalanceTrend: [],
    otherSavingsBalanceTrend: [],
    nisaContributionTrend: [],
    cardUnpaidTrend: [],
  },
}

describe('MonthlyReport 集約', () => {
  it('CSV確定状態を parse できる', () => {
    expect(() =>
      MonthlyReportSchema.parse({
        kind: 'csv_confirmed',
        common: baseCommon,
        csvConfirmedAt: new Date(),
        causingTransactionIds: [],
      }),
    ).not.toThrow()
  })

  it('最終確定状態を parse できる', () => {
    expect(() =>
      MonthlyReportSchema.parse({
        kind: 'finalized',
        common: baseCommon,
        csvConfirmedAt: new Date(),
        finalizedAt: new Date(),
        expenseReimbursementId: 'reimb_001' as never,
        expenseReimbursementMatchedAt: new Date(),
        unapprovedTransfers: [],
      }),
    ).not.toThrow()
  })

  it('finalize() は CSV確定 → 最終確定の遷移を生成する', () => {
    const csvConfirmed = MonthlyReportSchema.parse({
      kind: 'csv_confirmed',
      common: baseCommon,
      csvConfirmedAt: new Date('2026-05-01'),
      causingTransactionIds: [],
    }) as CsvConfirmedReport

    const finalized = finalize(
      csvConfirmed,
      'reimb_001' as never,
      new Date('2026-05-15'),
      [],
      new Date('2026-05-16'),
    )

    expect(finalized.kind).toBe('finalized')
    expect(finalized.csvConfirmedAt).toEqual(new Date('2026-05-01'))
  })

  it('finalize() は不正データなら throw', () => {
    const csvConfirmed = MonthlyReportSchema.parse({
      kind: 'csv_confirmed',
      common: baseCommon,
      csvConfirmedAt: new Date('2026-05-01'),
      causingTransactionIds: [],
    }) as CsvConfirmedReport

    expect(() =>
      finalize(csvConfirmed, '' as never, new Date(), [], new Date()),
    ).toThrow()
  })
})
```

- [ ] **Step 2: テストの失敗を確認**

Run: `pnpm --filter @household/domain test MonthlyReport`
Expected: FAIL。

- [ ] **Step 3: MonthlyReport.ts を作成**

`packages/domain/src/household-analysis/aggregates/MonthlyReport.ts`:
```ts
/**
 * 月次レポート集約（家計分析コンテキスト）
 * @see docs/domain/08c-ul-家計分析.md §1
 * @see docs/domain/09-aggregates.md #8
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.2
 *
 * kawasima: data 月次レポート = CSV確定月次レポート OR 最終確定月次レポート
 * 不変条件: CSV確定 → 最終確定 の単方向遷移のみ許容（finalized → csv_confirmed への関数を提供しない）
 */
import { z } from 'zod'
import {
  MonthlyReportIdSchema,
  TransactionIdSchema,
  ExpenseReimbursementIdSchema,
  CategoryIdSchema,
  type ExpenseReimbursementId,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'

/** 残高推移パート（残高・資産推移管理から借用する Read-only データ） */
export const BalanceTrendSchema = z.object({
  smbcBalanceTrend: z.array(z.object({ date: z.date(), balance: MoneySchema })),
  otherSavingsBalanceTrend: z.array(z.object({ date: z.date(), balance: MoneySchema })),
  nisaContributionTrend: z.array(z.object({ date: z.date(), accumulated: MoneySchema })),
  cardUnpaidTrend: z.array(z.object({ date: z.date(), unpaidTotal: MoneySchema })),
})
export type BalanceTrend = z.infer<typeof BalanceTrendSchema>

/** 月次レポート共通属性 */
export const CommonMonthlyReportAttrsSchema = z.object({
  monthlyReportId: MonthlyReportIdSchema,
  targetYearMonth: YearMonthSchema,
  householdCategoryTotals: z.array(
    z.object({
      categoryId: CategoryIdSchema,
      total: MoneySchema,
    }),
  ),
  personalTotalHoney: MoneySchema,
  personalTotalDarling: MoneySchema,
  businessExpenseTotalHoney: MoneySchema,
  businessExpenseTotalDarling: MoneySchema,
  nisaContributionAccumulated: MoneySchema,
  balanceTrend: BalanceTrendSchema,
  isIncompleteMonth: z.boolean().optional(),
})
export type CommonMonthlyReportAttrs = z.infer<typeof CommonMonthlyReportAttrsSchema>

/** 不認定分振替 */
export const UnapprovedExpenseTransferSchema = z.object({
  originalBusinessExpenseTransactionId: TransactionIdSchema,
  transferTarget: z.enum(['personal_honey', 'personal_darling']),
  transferAmount: MoneySchema,
  transferredAt: z.date(),
})
export type UnapprovedExpenseTransfer = z.infer<typeof UnapprovedExpenseTransferSchema>

/** 月次レポート（discriminated union） */
export const MonthlyReportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('csv_confirmed'),
    common: CommonMonthlyReportAttrsSchema,
    csvConfirmedAt: z.date(),
    causingTransactionIds: z.array(TransactionIdSchema),
  }),
  z.object({
    kind: z.literal('finalized'),
    common: CommonMonthlyReportAttrsSchema,
    csvConfirmedAt: z.date(),
    finalizedAt: z.date(),
    expenseReimbursementId: ExpenseReimbursementIdSchema,
    expenseReimbursementMatchedAt: z.date(),
    unapprovedTransfers: z.array(UnapprovedExpenseTransferSchema),
  }),
])
export type MonthlyReport = z.infer<typeof MonthlyReportSchema>

export type CsvConfirmedReport = Extract<MonthlyReport, { kind: 'csv_confirmed' }>
export type FinalizedReport = Extract<MonthlyReport, { kind: 'finalized' }>

/** 状態遷移: CSV確定 → 最終確定（単方向） */
export function finalize(
  report: CsvConfirmedReport,
  expenseReimbursementId: ExpenseReimbursementId,
  matchedAt: Date,
  unapprovedTransfers: UnapprovedExpenseTransfer[],
  finalizedAt: Date,
): FinalizedReport {
  return MonthlyReportSchema.parse({
    kind: 'finalized',
    common: report.common,
    csvConfirmedAt: report.csvConfirmedAt,
    finalizedAt,
    expenseReimbursementId,
    expenseReimbursementMatchedAt: matchedAt,
    unapprovedTransfers,
  }) as FinalizedReport
}

// finalized → csv_confirmed への逆遷移関数は型として存在しない（不変条件で禁止）
```

- [ ] **Step 4: aggregates/index.ts を作成**

`packages/domain/src/household-analysis/aggregates/index.ts`:
```ts
export * from './Transaction'
export * from './MonthlyReport'
```

- [ ] **Step 5: テストの成功を確認**

Run: `pnpm --filter @household/domain test MonthlyReport`
Expected: PASS（4 件）。

- [ ] **Step 6: コミット**

```bash
git add packages/domain/src/household-analysis/aggregates/ packages/domain/tests/household-analysis/aggregates/MonthlyReport.test.ts
git commit -m "feat(domain/household-analysis): MonthlyReport 集約と aggregates barrel を追加"
```

---

## Task 15: 家計分析の Repository I/F + barrel

**Files:**
- Create: `packages/domain/src/household-analysis/repositories/TransactionRepository.ts`
- Create: `packages/domain/src/household-analysis/repositories/MonthlyReportRepository.ts`
- Create: `packages/domain/src/household-analysis/repositories/index.ts`

- [ ] **Step 1: TransactionRepository.ts を作成**

```ts
/**
 * 取引集約の永続化 I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.3
 *
 * Phase 4 では interface 定義のみ。実装は Phase 5 以降の adapter 層。
 */
import type { TransactionId, UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { Transaction } from '../aggregates/Transaction'

export interface TransactionRepository {
  /** ID で取引を取得。見つからなければ null。 */
  findById(id: TransactionId): Promise<Transaction | null>

  /** 指定ユーザーの指定月の全取引を取得（プライバシー適用なし、Read 側で適用する） */
  findByMonth(ownerId: UserId, month: YearMonth): Promise<Transaction[]>

  /** 取引を保存（新規・更新両対応、状態遷移後の集約をそのまま渡す） */
  save(transaction: Transaction): Promise<void>
}
```

- [ ] **Step 2: MonthlyReportRepository.ts を作成**

```ts
/**
 * 月次レポート集約の永続化 I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.3
 */
import type { MonthlyReportId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { MonthlyReport } from '../aggregates/MonthlyReport'

export interface MonthlyReportRepository {
  findById(id: MonthlyReportId): Promise<MonthlyReport | null>
  findByMonth(month: YearMonth): Promise<MonthlyReport | null>
  save(report: MonthlyReport): Promise<void>
}
```

- [ ] **Step 3: repositories/index.ts を作成**

```ts
export * from './TransactionRepository'
export * from './MonthlyReportRepository'
```

- [ ] **Step 4: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add packages/domain/src/household-analysis/repositories/
git commit -m "feat(domain/household-analysis): Repository I/F を追加"
```

---

## Task 16: 家計分析の View 型一式

**Files:**
- Create: `packages/domain/src/household-analysis/queries/views/DashboardKpisView.ts`
- Create: `packages/domain/src/household-analysis/queries/views/CategoryBreakdownView.ts`
- Create: `packages/domain/src/household-analysis/queries/views/MonthlyReportView.ts`
- Create: `packages/domain/src/household-analysis/queries/views/TransactionListItem.ts`
- Create: `packages/domain/src/household-analysis/queries/views/index.ts`

- [ ] **Step 1: DashboardKpisView.ts を作成**

```ts
/**
 * Phase 3.5 ダッシュボード KPI 4 枚に対応
 * @see docs/domain/wireframes/README.md §1
 * @see docs/superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md §6
 */
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const DashboardKpisViewSchema = z.object({
  mode: z.enum(['household', 'personal']),
  /** 当月支出 */
  currentMonthSpending: MoneySchema,
  /** 貯蓄残高（SMBC + 別銀行貯蓄合算）— 残高・資産推移管理から借用 */
  savingsBalance: MoneySchema,
  /** NISA 積立原資（累計）— 残高・資産推移管理から借用 */
  nisaContributionAccumulated: MoneySchema,
  /** 資産合計 = 貯蓄残高 + NISA 積立原資 - 三井住友カード未払金 */
  totalAssets: MoneySchema,
})
export type DashboardKpisView = z.infer<typeof DashboardKpisViewSchema>
```

- [ ] **Step 2: CategoryBreakdownView.ts を作成**

```ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { CategoryIdSchema } from '../../../shared/ids'

export const CategoryBreakdownItemSchema = z.object({
  categoryId: CategoryIdSchema,
  categoryName: z.string(),
  total: MoneySchema,
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
})
export type CategoryBreakdownItem = z.infer<typeof CategoryBreakdownItemSchema>

export const CategoryBreakdownViewSchema = z.object({
  mode: z.enum(['household', 'personal']),
  yearMonth: z.string(),
  totalAmount: MoneySchema,
  items: z.array(CategoryBreakdownItemSchema),
})
export type CategoryBreakdownView = z.infer<typeof CategoryBreakdownViewSchema>
```

- [ ] **Step 3: MonthlyReportView.ts を作成**

```ts
import { z } from 'zod'
import {
  CommonMonthlyReportAttrsSchema,
  UnapprovedExpenseTransferSchema,
} from '../../aggregates/MonthlyReport'

export const MonthlyReportViewSchema = z.object({
  status: z.enum(['csv_confirmed', 'finalized']),
  common: CommonMonthlyReportAttrsSchema,
  csvConfirmedAt: z.date(),
  finalizedAt: z.date().nullable(),
  unapprovedTransfers: z.array(UnapprovedExpenseTransferSchema).nullable(),
})
export type MonthlyReportView = z.infer<typeof MonthlyReportViewSchema>
```

- [ ] **Step 4: TransactionListItem.ts を作成**

```ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { ExpenseClassSchema } from '../../../shared/value-objects/ExpenseClass'
import { TransactionIdSchema, CategoryIdSchema } from '../../../shared/ids'

/**
 * 取引一覧の 1 行。プライバシー 3 段階適用済み。
 * - 配偶者の個人取引は merchantName / amount を null
 * - 経費(会社) で他人の取引はリスト自体から除外
 * - 未分類取引は所有者本人のみリスト掲載
 */
export const TransactionListItemSchema = z.object({
  transactionId: TransactionIdSchema,
  occurredAt: z.date(),
  expenseClass: ExpenseClassSchema,
  categoryId: CategoryIdSchema.nullable(),
  categoryName: z.string().nullable(),
  merchantName: z.string().nullable(),
  amount: MoneySchema.nullable(),
  isUnclassified: z.boolean(),
})
export type TransactionListItem = z.infer<typeof TransactionListItemSchema>
```

- [ ] **Step 5: views/index.ts を作成**

```ts
export * from './DashboardKpisView'
export * from './CategoryBreakdownView'
export * from './MonthlyReportView'
export * from './TransactionListItem'
```

- [ ] **Step 6: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 7: コミット**

```bash
git add packages/domain/src/household-analysis/queries/views/
git commit -m "feat(domain/household-analysis): View 型 4 種を追加"
```

---

## Task 17: 家計分析の Query I/F + barrel

**Files:**
- Create: `packages/domain/src/household-analysis/queries/DashboardQuery.ts`
- Create: `packages/domain/src/household-analysis/queries/MonthlyReportQuery.ts`
- Create: `packages/domain/src/household-analysis/queries/TransactionListQuery.ts`
- Create: `packages/domain/src/household-analysis/queries/index.ts`

- [ ] **Step 1: DashboardQuery.ts を作成**

```ts
/**
 * ダッシュボード Query I/F（Read 側、プライバシー適用済み）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.4
 */
import type { UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { DashboardKpisView } from './views/DashboardKpisView'
import type { CategoryBreakdownView } from './views/CategoryBreakdownView'

export type DashboardMode = 'household' | 'personal'

export interface DashboardQuery {
  fetchKpis(viewerId: UserId, month: YearMonth, mode: DashboardMode): Promise<DashboardKpisView>
  fetchCategoryBreakdown(
    viewerId: UserId,
    month: YearMonth,
    mode: DashboardMode,
  ): Promise<CategoryBreakdownView>
}
```

- [ ] **Step 2: MonthlyReportQuery.ts を作成**

```ts
import type { UserId, MonthlyReportId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { MonthlyReportView } from './views/MonthlyReportView'

export interface MonthlyReportQuery {
  fetchByMonth(viewerId: UserId, month: YearMonth): Promise<MonthlyReportView | null>
  fetchById(viewerId: UserId, id: MonthlyReportId): Promise<MonthlyReportView | null>
}
```

- [ ] **Step 3: TransactionListQuery.ts を作成**

```ts
import type { UserId, TransactionId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { ExpenseClass } from '../../shared/value-objects/ExpenseClass'
import type { TransactionListItem } from './views/TransactionListItem'

export interface TransactionListFilter {
  month: YearMonth
  expenseClass?: ExpenseClass
  isUnclassifiedOnly?: boolean
}

export interface UnclassifiedSummary {
  count: number
  recentIds: TransactionId[]
}

export interface TransactionListQuery {
  fetch(viewerId: UserId, filter: TransactionListFilter): Promise<TransactionListItem[]>
  fetchUnclassifiedSummary(viewerId: UserId, month: YearMonth): Promise<UnclassifiedSummary>
}
```

- [ ] **Step 4: queries/index.ts を作成**

```ts
export * from './views'
export * from './DashboardQuery'
export * from './MonthlyReportQuery'
export * from './TransactionListQuery'
```

- [ ] **Step 5: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/domain/src/household-analysis/queries/
git commit -m "feat(domain/household-analysis): Query I/F 3 種と queries barrel を追加"
```

---

## Task 18: ViewerContext

**Files:**
- Create: `packages/domain/src/household-analysis/privacy/ViewerContext.ts`

- [ ] **Step 1: ViewerContext.ts を作成**

```ts
/**
 * 閲覧者コンテキスト（プライバシー判定の入力）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.5
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'

export const ViewerRoleSchema = z.enum(['honey', 'darling'])
export type ViewerRole = z.infer<typeof ViewerRoleSchema>

export const ViewerContextSchema = z.object({
  viewerId: UserIdSchema,
  role: ViewerRoleSchema,
})
export type ViewerContext = z.infer<typeof ViewerContextSchema>
```

- [ ] **Step 2: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add packages/domain/src/household-analysis/privacy/ViewerContext.ts
git commit -m "feat(domain/household-analysis): ViewerContext を追加"
```

---

## Task 19: applyPrivacyFilter ヘルパ + プライバシーマトリクステスト + privacy barrel

**Files:**
- Create: `packages/domain/src/household-analysis/privacy/applyPrivacyFilter.ts`
- Create: `packages/domain/src/household-analysis/privacy/index.ts`
- Create: `packages/domain/tests/household-analysis/privacy/applyPrivacyFilter.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/domain/tests/household-analysis/privacy/applyPrivacyFilter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toListItems, isVisibleAsDetail, isVisibleAsAggregate } from '../../../src/household-analysis/privacy/applyPrivacyFilter'
import type { ViewerContext } from '../../../src/household-analysis/privacy/ViewerContext'
import type { Transaction, ClassifiedTransaction } from '../../../src/household-analysis/aggregates/Transaction'

const HONEY_ID = 'user_honey' as never
const DARLING_ID = 'user_darling' as never

const honeyViewer: ViewerContext = { viewerId: HONEY_ID, role: 'honey' }
const darlingViewer: ViewerContext = { viewerId: DARLING_ID, role: 'darling' }

function makeClassified(ownerId: string, expenseClass: 'household' | 'personal_honey' | 'personal_darling' | 'business_expense'): ClassifiedTransaction {
  const expenseTypeRef = expenseClass === 'business_expense'
    ? { kind: 'business' as const, expenseTypeId: 'exp_001' as never }
    : { kind: 'non_business' as const }
  return {
    kind: 'classified',
    common: {
      transactionId: `tx_${ownerId}_${expenseClass}` as never,
      ownerUserId: ownerId as never,
      merchantName: 'スーパーA',
      amount: 1000 as never,
      occurredAt: new Date(),
      importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: ownerId as never },
    },
    details: {
      categoryId: 'cat_001' as never,
      expenseClass,
      expenseTypeRef,
      basis: { kind: 'user_manual', modifiedByUserId: ownerId as never, modifiedAt: new Date() },
    },
  }
}

describe('applyPrivacyFilter', () => {
  describe('isVisibleAsDetail マトリクス', () => {
    it('世帯費用は両者に明細可視', () => {
      const tx = makeClassified(HONEY_ID, 'household')
      expect(isVisibleAsDetail(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsDetail(tx, darlingViewer)).toBe(true)
    })

    it('個人(本人) は本人のみ明細可視', () => {
      const tx = makeClassified(HONEY_ID, 'personal_honey')
      expect(isVisibleAsDetail(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsDetail(tx, darlingViewer)).toBe(false)
    })

    it('経費(会社) は本人のみ明細可視', () => {
      const tx = makeClassified(HONEY_ID, 'business_expense')
      expect(isVisibleAsDetail(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsDetail(tx, darlingViewer)).toBe(false)
    })
  })

  describe('isVisibleAsAggregate マトリクス', () => {
    it('世帯費用は両者の合計に含まれる', () => {
      const tx = makeClassified(HONEY_ID, 'household')
      expect(isVisibleAsAggregate(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsAggregate(tx, darlingViewer)).toBe(true)
    })

    it('個人(本人) は両者の合計に含まれる（合計のみ可視）', () => {
      const tx = makeClassified(HONEY_ID, 'personal_honey')
      expect(isVisibleAsAggregate(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsAggregate(tx, darlingViewer)).toBe(true)
    })

    it('経費(会社) は本人の合計のみ含まれる', () => {
      const tx = makeClassified(HONEY_ID, 'business_expense')
      expect(isVisibleAsAggregate(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsAggregate(tx, darlingViewer)).toBe(false)
    })
  })

  describe('toListItems', () => {
    const categoryNames = new Map<string, string>([['cat_001', '食費']])

    it('経費(会社) で他人の取引はリストから除外', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'business_expense')]
      const items = toListItems(txs, darlingViewer, categoryNames)
      expect(items).toHaveLength(0)
    })

    it('経費(会社) で本人の取引はリストに含まれる', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'business_expense')]
      const items = toListItems(txs, honeyViewer, categoryNames)
      expect(items).toHaveLength(1)
      expect(items[0]?.merchantName).toBe('スーパーA')
      expect(items[0]?.amount).toBe(1000)
    })

    it('個人(本人) の取引は配偶者には merchantName / amount が null', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'personal_honey')]
      const items = toListItems(txs, darlingViewer, categoryNames)
      expect(items).toHaveLength(1)
      expect(items[0]?.merchantName).toBeNull()
      expect(items[0]?.amount).toBeNull()
    })

    it('世帯費用は両者に明細可視', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'household')]
      const items = toListItems(txs, darlingViewer, categoryNames)
      expect(items).toHaveLength(1)
      expect(items[0]?.merchantName).toBe('スーパーA')
      expect(items[0]?.amount).toBe(1000)
    })

    it('未分類取引は所有者本人のみリスト掲載（配偶者は除外）', () => {
      const txs: Transaction[] = [
        {
          kind: 'unclassified',
          common: {
            transactionId: 'tx_unclass' as never,
            ownerUserId: HONEY_ID,
            merchantName: '不明加盟店',
            amount: 500 as never,
            occurredAt: new Date(),
            importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: HONEY_ID },
          },
          reason: 'merchant_rule_unlearned',
          defaultExpenseClass: 'personal_honey',
        },
      ]
      expect(toListItems(txs, honeyViewer, categoryNames)).toHaveLength(1)
      expect(toListItems(txs, darlingViewer, categoryNames)).toHaveLength(0)
    })

    it('削除済み取引は常にリストから除外', () => {
      const txs: Transaction[] = [
        {
          kind: 'deleted',
          common: {
            transactionId: 'tx_del' as never,
            ownerUserId: HONEY_ID,
            merchantName: '削除済み',
            amount: 100 as never,
            occurredAt: new Date(),
            importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: HONEY_ID },
          },
          deletedAt: new Date(),
          deletionReason: 'user_deleted',
        },
      ]
      expect(toListItems(txs, honeyViewer, categoryNames)).toHaveLength(0)
      expect(toListItems(txs, darlingViewer, categoryNames)).toHaveLength(0)
    })
  })
})
```

- [ ] **Step 2: テストの失敗を確認**

Run: `pnpm --filter @household/domain test applyPrivacyFilter`
Expected: FAIL — applyPrivacyFilter.ts が存在しない。

- [ ] **Step 3: applyPrivacyFilter.ts を作成**

`packages/domain/src/household-analysis/privacy/applyPrivacyFilter.ts`:
```ts
/**
 * プライバシー 3 段階を取引リストに適用するヘルパ。
 * Query レイヤから呼ばれる唯一のプライバシー判定ポイント。
 *
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.5
 *
 * ルール:
 *  1. 世帯（household）: 両者に明細・合計とも可視
 *  2. 個人(本人)（personal_honey/darling）: 本人には明細・合計、配偶者には合計のみ可視
 *  3. 経費(会社)（business_expense）: 本人のみ明細・合計可視、配偶者には一切不可視
 *  4. 未分類: 08c F-1 個人別、所有者本人のみリスト可視
 *  5. 削除済み: リストから常に除外
 */
import type {
  Transaction,
  ClassifiedTransaction,
} from '../aggregates/Transaction'
import type { ViewerContext } from './ViewerContext'
import type { TransactionListItem } from '../queries/views/TransactionListItem'

export function isVisibleAsDetail(tx: ClassifiedTransaction, viewer: ViewerContext): boolean {
  const ec = tx.details.expenseClass
  if (ec === 'household') return true
  if (ec === 'business_expense') return tx.common.ownerUserId === viewer.viewerId
  return tx.common.ownerUserId === viewer.viewerId
}

export function isVisibleAsAggregate(tx: ClassifiedTransaction, viewer: ViewerContext): boolean {
  const ec = tx.details.expenseClass
  if (ec === 'household') return true
  if (ec === 'business_expense') return tx.common.ownerUserId === viewer.viewerId
  return true
}

export function toListItems(
  txs: Transaction[],
  viewer: ViewerContext,
  categoryNames: Map<string, string>,
): TransactionListItem[] {
  return txs
    .filter(tx => tx.kind !== 'deleted')
    .filter(tx => {
      if (tx.kind === 'unclassified') {
        return tx.common.ownerUserId === viewer.viewerId
      }
      if (tx.kind === 'classified' && tx.details.expenseClass === 'business_expense') {
        return tx.common.ownerUserId === viewer.viewerId
      }
      return true
    })
    .map(tx => {
      if (tx.kind === 'unclassified') {
        return {
          transactionId: tx.common.transactionId,
          occurredAt: tx.common.occurredAt,
          expenseClass: tx.defaultExpenseClass,
          categoryId: null,
          categoryName: null,
          merchantName: tx.common.merchantName,
          amount: tx.common.amount,
          isUnclassified: true,
        }
      }
      // classified（filter で deleted は除外済み）
      const classified = tx as ClassifiedTransaction
      const detailVisible = isVisibleAsDetail(classified, viewer)
      return {
        transactionId: classified.common.transactionId,
        occurredAt: classified.common.occurredAt,
        expenseClass: classified.details.expenseClass,
        categoryId: classified.details.categoryId,
        categoryName: categoryNames.get(classified.details.categoryId) ?? null,
        merchantName: detailVisible ? classified.common.merchantName : null,
        amount: detailVisible ? classified.common.amount : null,
        isUnclassified: false,
      }
    })
}
```

- [ ] **Step 4: privacy/index.ts を作成**

```ts
export * from './ViewerContext'
// applyPrivacyFilter は内部実装のため非公開（barrel から export しない）
```

- [ ] **Step 5: テストの成功を確認**

Run: `pnpm --filter @household/domain test applyPrivacyFilter`
Expected: PASS（11 件）。

- [ ] **Step 6: コミット**

```bash
git add packages/domain/src/household-analysis/privacy/ packages/domain/tests/household-analysis/privacy/
git commit -m "feat(domain/household-analysis): プライバシーフィルタとマトリクステストを追加"
```

---

## Task 20: 家計分析のドメインイベント 3 種 + barrel

**Files:**
- Create: `packages/domain/src/household-analysis/events/MonthlyReportCsvConfirmed.ts`
- Create: `packages/domain/src/household-analysis/events/MonthlyReportFinalized.ts`
- Create: `packages/domain/src/household-analysis/events/TransactionDeleted.ts`
- Create: `packages/domain/src/household-analysis/events/index.ts`

- [ ] **Step 1: MonthlyReportCsvConfirmed.ts を作成**

```ts
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyReportIdSchema } from '../../shared/ids'

export const MonthlyReportCsvConfirmedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyReportCsvConfirmed'),
  monthlyReportId: MonthlyReportIdSchema,
  csvConfirmedAt: z.date(),
})
export type MonthlyReportCsvConfirmed = z.infer<typeof MonthlyReportCsvConfirmedSchema>
```

- [ ] **Step 2: MonthlyReportFinalized.ts を作成**

```ts
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyReportIdSchema, ExpenseReimbursementIdSchema } from '../../shared/ids'

export const MonthlyReportFinalizedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyReportFinalized'),
  monthlyReportId: MonthlyReportIdSchema,
  finalizedAt: z.date(),
  expenseReimbursementId: ExpenseReimbursementIdSchema,
})
export type MonthlyReportFinalized = z.infer<typeof MonthlyReportFinalizedSchema>
```

- [ ] **Step 3: TransactionDeleted.ts を作成**

```ts
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TransactionIdSchema, UserIdSchema } from '../../shared/ids'
import { DeletionReasonSchema } from '../aggregates/Transaction'

export const TransactionDeletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('TransactionDeleted'),
  transactionId: TransactionIdSchema,
  deletedByUserId: UserIdSchema,
  deletionReason: DeletionReasonSchema,
})
export type TransactionDeleted = z.infer<typeof TransactionDeletedSchema>
```

- [ ] **Step 4: events/index.ts を作成**

```ts
export * from './MonthlyReportCsvConfirmed'
export * from './MonthlyReportFinalized'
export * from './TransactionDeleted'
```

- [ ] **Step 5: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/domain/src/household-analysis/events/
git commit -m "feat(domain/household-analysis): ドメインイベント 3 種を追加"
```

---

## Task 21: household-analysis の barrel

**Files:**
- Create: `packages/domain/src/household-analysis/index.ts`

- [ ] **Step 1: index.ts を作成**

```ts
export * from './aggregates'
export * from './value-objects'
export * from './repositories'
export * from './queries'
export * from './events'
export type { ViewerContext, ViewerRole } from './privacy/ViewerContext'
export { ViewerContextSchema, ViewerRoleSchema } from './privacy/ViewerContext'
```

- [ ] **Step 2: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add packages/domain/src/household-analysis/index.ts
git commit -m "feat(domain/household-analysis): コンテキストの barrel を追加"
```

---

# Phase D: 残高・資産推移管理コンテキスト（Tasks 22-29）

## Task 22: BankName / BrokerageName 値オブジェクト + barrel

**Files:**
- Create: `packages/domain/src/balance-asset-tracking/value-objects/BankName.ts`
- Create: `packages/domain/src/balance-asset-tracking/value-objects/BrokerageName.ts`
- Create: `packages/domain/src/balance-asset-tracking/value-objects/index.ts`

- [ ] **Step 1: BankName.ts を作成**

```ts
/**
 * 別銀行貯蓄口座の表示用銀行名（per-user 編集可、Phase 3.5 追加）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 */
import { z } from 'zod'

export const BankNameSchema = z.string().min(1).max(50).brand<'BankName'>()
export type BankName = z.infer<typeof BankNameSchema>
```

- [ ] **Step 2: BrokerageName.ts を作成**

```ts
/**
 * NISA 口座の表示用証券会社名（per-user 編集可、Phase 3.5 追加）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * kawasima: data 証券会社名 = SBI証券 OR 楽天証券 OR その他証券会社
 */
import { z } from 'zod'

export const BrokerageNameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sbi') }),
  z.object({ kind: z.literal('rakuten') }),
  z.object({ kind: z.literal('other'), customName: z.string().min(1).max(50) }),
])
export type BrokerageName = z.infer<typeof BrokerageNameSchema>

export function brokerageNameToDisplay(name: BrokerageName): string {
  switch (name.kind) {
    case 'sbi':
      return 'SBI証券'
    case 'rakuten':
      return '楽天証券'
    case 'other':
      return name.customName
  }
}
```

- [ ] **Step 3: value-objects/index.ts を作成**

```ts
export * from './BankName'
export * from './BrokerageName'
```

- [ ] **Step 4: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add packages/domain/src/balance-asset-tracking/value-objects/
git commit -m "feat(domain/balance-asset-tracking): BankName / BrokerageName 値オブジェクトを追加"
```

---

## Task 23: Account 集約 + テスト

**Files:**
- Create: `packages/domain/src/balance-asset-tracking/aggregates/Account.ts`
- Create: `packages/domain/tests/balance-asset-tracking/aggregates/Account.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/domain/tests/balance-asset-tracking/aggregates/Account.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { AccountSchema } from '../../../src/balance-asset-tracking/aggregates/Account'

const baseCommon = {
  accountId: 'acc_001' as never,
  ownerUserId: 'user_honey' as never,
  registeredAt: new Date(),
  activeness: { kind: 'active' as const },
}

describe('Account 集約', () => {
  it('SMBC 銀行口座を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'smbc_bank',
        common: baseCommon,
        balance: {
          currentBalance: 100000 as never,
          initialBalance: 100000 as never,
          initialBalanceBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })

  it('三井住友カード口座を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'mitsui_sumitomo_card',
        common: baseCommon,
        unpaidAggregateRef: 'unp_001' as never,
      }),
    ).not.toThrow()
  })

  it('別銀行貯蓄口座（銀行名付き、Phase 3.5）を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'other_savings',
        common: baseCommon,
        bankName: '楽天銀行' as never,
        balance: {
          currentBalance: 500000 as never,
          initialBalance: 500000 as never,
          initialBalanceBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
        freshnessSource: { lastUpdatedAt: new Date() },
      }),
    ).not.toThrow()
  })

  it('NISA 口座（証券会社名付き、Phase 3.5）を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'nisa',
        common: baseCommon,
        brokerageName: { kind: 'sbi' },
        contribution: {
          currentAccumulated: 200000 as never,
          initialAccumulated: 0 as never,
          initialAccumulatedBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })

  it('NISA 口座でカスタム証券会社名を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'nisa',
        common: baseCommon,
        brokerageName: { kind: 'other', customName: 'マネックス証券' },
        contribution: {
          currentAccumulated: 100000 as never,
          initialAccumulated: 0 as never,
          initialAccumulatedBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })

  it('非アクティブ状態の口座も表現可能', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'smbc_bank',
        common: {
          ...baseCommon,
          activeness: {
            kind: 'inactive',
            inactivatedAt: new Date(),
            reason: '使わなくなったため',
          },
        },
        balance: {
          currentBalance: 0 as never,
          initialBalance: 100000 as never,
          initialBalanceBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: テストの失敗を確認**

Run: `pnpm --filter @household/domain test Account`
Expected: FAIL — Account.ts が存在しない。

- [ ] **Step 3: Account.ts を作成**

`packages/domain/src/balance-asset-tracking/aggregates/Account.ts`:
```ts
/**
 * 口座集約（残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/09-aggregates.md #9
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.1
 *
 * kawasima: data 口座 = SMBC銀行口座 OR 三井住友カード OR 別銀行貯蓄口座 OR NISA口座
 *
 * 不変条件:
 *  - 同一ユーザーID + 口座種別の組合せは一意（Repository.save 時にチェック、Phase 5）
 *  - 銀行名・証券会社名は所有者本人のみ変更可（Repository 呼び出し側で検証、Phase 5）
 */
import { z } from 'zod'
import {
  AccountIdSchema,
  UserIdSchema,
  MitsuiSumitomoUnpaidIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { BankNameSchema } from '../value-objects/BankName'
import { BrokerageNameSchema } from '../value-objects/BrokerageName'

export const ActivenessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('active') }),
  z.object({
    kind: z.literal('inactive'),
    inactivatedAt: z.date(),
    reason: z.string(),
  }),
])
export type Activeness = z.infer<typeof ActivenessSchema>

export const CommonAccountAttrsSchema = z.object({
  accountId: AccountIdSchema,
  ownerUserId: UserIdSchema,
  registeredAt: z.date(),
  activeness: ActivenessSchema,
})
export type CommonAccountAttrs = z.infer<typeof CommonAccountAttrsSchema>

export const SmbcBalanceSchema = z.object({
  currentBalance: MoneySchema,
  initialBalance: MoneySchema,
  initialBalanceBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
})
export type SmbcBalance = z.infer<typeof SmbcBalanceSchema>

export const OtherSavingsBalanceSchema = z.object({
  currentBalance: MoneySchema,
  initialBalance: MoneySchema,
  initialBalanceBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
})
export type OtherSavingsBalance = z.infer<typeof OtherSavingsBalanceSchema>

export const NisaContributionSchema = z.object({
  currentAccumulated: MoneySchema,
  initialAccumulated: MoneySchema,
  initialAccumulatedBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
})
export type NisaContribution = z.infer<typeof NisaContributionSchema>

export const BalanceFreshnessSourceSchema = z.object({
  lastUpdatedAt: z.date(),
})
export type BalanceFreshnessSource = z.infer<typeof BalanceFreshnessSourceSchema>

export const AccountSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('smbc_bank'),
    common: CommonAccountAttrsSchema,
    balance: SmbcBalanceSchema,
  }),
  z.object({
    kind: z.literal('mitsui_sumitomo_card'),
    common: CommonAccountAttrsSchema,
    unpaidAggregateRef: MitsuiSumitomoUnpaidIdSchema,
  }),
  z.object({
    kind: z.literal('other_savings'),
    common: CommonAccountAttrsSchema,
    bankName: BankNameSchema,
    balance: OtherSavingsBalanceSchema,
    freshnessSource: BalanceFreshnessSourceSchema,
  }),
  z.object({
    kind: z.literal('nisa'),
    common: CommonAccountAttrsSchema,
    brokerageName: BrokerageNameSchema,
    contribution: NisaContributionSchema,
  }),
])
export type Account = z.infer<typeof AccountSchema>

export type SmbcBankAccount = Extract<Account, { kind: 'smbc_bank' }>
export type MitsuiSumitomoCardAccount = Extract<Account, { kind: 'mitsui_sumitomo_card' }>
export type OtherSavingsAccount = Extract<Account, { kind: 'other_savings' }>
export type NisaAccount = Extract<Account, { kind: 'nisa' }>
```

- [ ] **Step 4: テストの成功を確認**

Run: `pnpm --filter @household/domain test Account`
Expected: PASS（6 件）。

- [ ] **Step 5: コミット**

```bash
git add packages/domain/src/balance-asset-tracking/aggregates/Account.ts packages/domain/tests/balance-asset-tracking/aggregates/Account.test.ts
git commit -m "feat(domain/balance-asset-tracking): Account 集約とテストを追加"
```

---

## Task 24: MitsuiSumitomoUnpaid 集約 + 不変条件テスト + aggregates barrel

**Files:**
- Create: `packages/domain/src/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid.ts`
- Create: `packages/domain/src/balance-asset-tracking/aggregates/index.ts`
- Create: `packages/domain/tests/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/domain/tests/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { MitsuiSumitomoUnpaidSchema } from '../../../src/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid'

describe('MitsuiSumitomoUnpaid 集約', () => {
  it('当月未払金合計 = Σ 計上中エントリ金額が一致すれば parse 成功', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: 'unp_001' as never,
        accountId: 'acc_001' as never,
        currentMonthUnpaidTotal: 8000 as never,
        entries: [
          {
            kind: 'booked',
            entryId: 'ent_001' as never,
            transactionId: 'tx_001' as never,
            bookedAt: new Date(),
            amount: 3000 as never,
          },
          {
            kind: 'booked',
            entryId: 'ent_002' as never,
            transactionId: 'tx_002' as never,
            bookedAt: new Date(),
            amount: 5000 as never,
          },
        ],
        lastSettledAt: null,
      }),
    ).not.toThrow()
  })

  it('当月未払金合計 ≠ Σ 計上中エントリ金額なら parse 失敗', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: 'unp_001' as never,
        accountId: 'acc_001' as never,
        currentMonthUnpaidTotal: 10000 as never,
        entries: [
          {
            kind: 'booked',
            entryId: 'ent_001' as never,
            transactionId: 'tx_001' as never,
            bookedAt: new Date(),
            amount: 3000 as never,
          },
          {
            kind: 'booked',
            entryId: 'ent_002' as never,
            transactionId: 'tx_002' as never,
            bookedAt: new Date(),
            amount: 5000 as never,
          },
        ],
        lastSettledAt: null,
      }),
    ).toThrow()
  })

  it('引落消込済みエントリは合計に含めない（消込後 currentMonthUnpaidTotal=0）', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: 'unp_001' as never,
        accountId: 'acc_001' as never,
        currentMonthUnpaidTotal: 0 as never,
        entries: [
          {
            kind: 'settled',
            entryId: 'ent_001' as never,
            transactionId: 'tx_001' as never,
            bookedAt: new Date(),
            settledAt: new Date(),
            amount: 3000 as never,
            settlementNoticeId: 'notice_001' as never,
          },
        ],
        lastSettledAt: new Date(),
      }),
    ).not.toThrow()
  })

  it('未払金エントリ無し（initial 状態）も parse 成功', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: 'unp_001' as never,
        accountId: 'acc_001' as never,
        currentMonthUnpaidTotal: 0 as never,
        entries: [],
        lastSettledAt: null,
      }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: テストの失敗を確認**

Run: `pnpm --filter @household/domain test MitsuiSumitomoUnpaid`
Expected: FAIL。

- [ ] **Step 3: MitsuiSumitomoUnpaid.ts を作成**

`packages/domain/src/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid.ts`:
```ts
/**
 * 三井住友カード未払金集約
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/09-aggregates.md #10
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.2
 *
 * 不変条件:
 *  - 当月未払金合計 = Σ 計上中エントリ金額（集約内整合）
 *  - 引落消込変動は冪等（同一 settlementNoticeId で重複適用しない、Phase 5 の application service で保証）
 */
import { z } from 'zod'
import {
  MitsuiSumitomoUnpaidIdSchema,
  AccountIdSchema,
  TransactionIdSchema,
  UnpaidEntryIdSchema,
  SettlementNoticeIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const UnpaidEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('booked'),
    entryId: UnpaidEntryIdSchema,
    transactionId: TransactionIdSchema,
    bookedAt: z.date(),
    amount: MoneySchema,
  }),
  z.object({
    kind: z.literal('settled'),
    entryId: UnpaidEntryIdSchema,
    transactionId: TransactionIdSchema,
    bookedAt: z.date(),
    settledAt: z.date(),
    amount: MoneySchema,
    settlementNoticeId: SettlementNoticeIdSchema,
  }),
])
export type UnpaidEntry = z.infer<typeof UnpaidEntrySchema>

export const MitsuiSumitomoUnpaidSchema = z
  .object({
    unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema,
    accountId: AccountIdSchema,
    currentMonthUnpaidTotal: MoneySchema,
    entries: z.array(UnpaidEntrySchema),
    lastSettledAt: z.date().nullable(),
  })
  .superRefine((agg, ctx) => {
    const sumBooked = agg.entries
      .filter((e): e is Extract<UnpaidEntry, { kind: 'booked' }> => e.kind === 'booked')
      .reduce((acc, e) => acc + e.amount, 0)
    if (sumBooked !== agg.currentMonthUnpaidTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `当月未払金合計（${agg.currentMonthUnpaidTotal}）と計上中エントリ合計（${sumBooked}）が一致しない`,
        path: ['currentMonthUnpaidTotal'],
      })
    }
  })
export type MitsuiSumitomoUnpaid = z.infer<typeof MitsuiSumitomoUnpaidSchema>
```

- [ ] **Step 4: aggregates/index.ts を作成**

```ts
export * from './Account'
export * from './MitsuiSumitomoUnpaid'
```

- [ ] **Step 5: テストの成功を確認**

Run: `pnpm --filter @household/domain test MitsuiSumitomoUnpaid`
Expected: PASS（4 件）。

- [ ] **Step 6: コミット**

```bash
git add packages/domain/src/balance-asset-tracking/aggregates/ packages/domain/tests/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid.test.ts
git commit -m "feat(domain/balance-asset-tracking): MitsuiSumitomoUnpaid 集約と不変条件テストを追加"
```

---

## Task 25: 残高・資産推移管理の Repository I/F + barrel

**Files:**
- Create: `packages/domain/src/balance-asset-tracking/repositories/AccountRepository.ts`
- Create: `packages/domain/src/balance-asset-tracking/repositories/MitsuiSumitomoUnpaidRepository.ts`
- Create: `packages/domain/src/balance-asset-tracking/repositories/index.ts`

- [ ] **Step 1: AccountRepository.ts を作成**

```ts
/**
 * 口座集約の永続化 I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.3
 */
import type { AccountId, UserId } from '../../shared/ids'
import type { Account } from '../aggregates/Account'

export interface AccountRepository {
  findById(id: AccountId): Promise<Account | null>
  findByOwner(ownerId: UserId): Promise<Account[]>
  /**
   * 集約の不変条件「同一ユーザー × 口座種別の一意性」は集約境界をまたぐため、
   * Repository.save 時の重複チェック方法は Phase 5 で確定する。
   */
  save(account: Account): Promise<void>
}
```

- [ ] **Step 2: MitsuiSumitomoUnpaidRepository.ts を作成**

```ts
import type { MitsuiSumitomoUnpaidId, AccountId } from '../../shared/ids'
import type { MitsuiSumitomoUnpaid } from '../aggregates/MitsuiSumitomoUnpaid'

export interface MitsuiSumitomoUnpaidRepository {
  findById(id: MitsuiSumitomoUnpaidId): Promise<MitsuiSumitomoUnpaid | null>
  findByCardAccountId(accountId: AccountId): Promise<MitsuiSumitomoUnpaid | null>
  save(unpaid: MitsuiSumitomoUnpaid): Promise<void>
}
```

- [ ] **Step 3: repositories/index.ts を作成**

```ts
export * from './AccountRepository'
export * from './MitsuiSumitomoUnpaidRepository'
```

- [ ] **Step 4: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add packages/domain/src/balance-asset-tracking/repositories/
git commit -m "feat(domain/balance-asset-tracking): Repository I/F を追加"
```

---

## Task 26: 残高・資産推移管理の View 型一式

**Files:**
- Create: `packages/domain/src/balance-asset-tracking/queries/views/AccountBalanceListView.ts`
- Create: `packages/domain/src/balance-asset-tracking/queries/views/BalanceTimeSeriesView.ts`
- Create: `packages/domain/src/balance-asset-tracking/queries/views/AssetTotalView.ts`
- Create: `packages/domain/src/balance-asset-tracking/queries/views/index.ts`

- [ ] **Step 1: AccountBalanceListView.ts を作成**

```ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { AccountIdSchema } from '../../../shared/ids'

export const AccountBalanceItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('smbc_bank'),
    accountId: AccountIdSchema,
    displayName: z.literal('三井住友銀行'),
    currentBalance: MoneySchema,
    lastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('mitsui_sumitomo_card'),
    accountId: AccountIdSchema,
    displayName: z.literal('三井住友カード'),
    currentMonthUnpaidTotal: MoneySchema,
    lastSettledAt: z.date().nullable(),
  }),
  z.object({
    kind: z.literal('other_savings'),
    accountId: AccountIdSchema,
    displayName: z.string(),
    currentBalance: MoneySchema,
    lastUpdatedAt: z.date(),
    daysSinceLastUpdate: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('nisa'),
    accountId: AccountIdSchema,
    displayName: z.string(),
    currentAccumulated: MoneySchema,
    lastUpdatedAt: z.date(),
  }),
])
export type AccountBalanceItem = z.infer<typeof AccountBalanceItemSchema>

export const AccountBalanceListViewSchema = z.object({
  items: z.array(AccountBalanceItemSchema),
})
export type AccountBalanceListView = z.infer<typeof AccountBalanceListViewSchema>
```

- [ ] **Step 2: BalanceTimeSeriesView.ts を作成**

```ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const BalancePointSchema = z.object({
  date: z.date(),
  amount: MoneySchema,
})
export type BalancePoint = z.infer<typeof BalancePointSchema>

export const BalanceTimeSeriesViewSchema = z.object({
  yearMonthRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
  smbc: z.array(BalancePointSchema),
  otherSavings: z.array(BalancePointSchema),
  nisaContribution: z.array(BalancePointSchema),
  cardUnpaid: z.array(BalancePointSchema),
})
export type BalanceTimeSeriesView = z.infer<typeof BalanceTimeSeriesViewSchema>
```

- [ ] **Step 3: AssetTotalView.ts を作成**

```ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const AssetTotalViewSchema = z.object({
  asOf: z.date(),
  smbcBalance: MoneySchema,
  otherSavingsBalance: MoneySchema,
  nisaContributionAccumulated: MoneySchema,
  cardUnpaidTotal: MoneySchema,
  /** = smbcBalance + otherSavingsBalance + nisaContributionAccumulated - cardUnpaidTotal */
  total: MoneySchema,
})
export type AssetTotalView = z.infer<typeof AssetTotalViewSchema>
```

- [ ] **Step 4: views/index.ts を作成**

```ts
export * from './AccountBalanceListView'
export * from './BalanceTimeSeriesView'
export * from './AssetTotalView'
```

- [ ] **Step 5: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/domain/src/balance-asset-tracking/queries/views/
git commit -m "feat(domain/balance-asset-tracking): View 型 3 種を追加"
```

---

## Task 27: 残高・資産推移管理の Query I/F + barrel

**Files:**
- Create: `packages/domain/src/balance-asset-tracking/queries/AccountBalanceQuery.ts`
- Create: `packages/domain/src/balance-asset-tracking/queries/BalanceTimeSeriesQuery.ts`
- Create: `packages/domain/src/balance-asset-tracking/queries/index.ts`

- [ ] **Step 1: AccountBalanceQuery.ts を作成**

```ts
/**
 * 口座残高 Query I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.4
 *
 * 注: 残高・資産推移管理は世帯共有のため viewerId 引数を取らない。
 * プライバシー（取引明細）の概念は家計分析側にあり、本コンテキストには適用されない。
 */
import type { AccountBalanceListView } from './views/AccountBalanceListView'
import type { AssetTotalView } from './views/AssetTotalView'

export interface AccountBalanceQuery {
  fetchBalanceList(): Promise<AccountBalanceListView>
  fetchAssetTotal(asOf: Date): Promise<AssetTotalView>
}
```

- [ ] **Step 2: BalanceTimeSeriesQuery.ts を作成**

```ts
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { BalanceTimeSeriesView } from './views/BalanceTimeSeriesView'

export interface BalanceTimeSeriesQuery {
  /** Phase 3.5 月次レポートの 4 軸時系列に対応 */
  fetch(from: YearMonth, to: YearMonth): Promise<BalanceTimeSeriesView>
}
```

- [ ] **Step 3: queries/index.ts を作成**

```ts
export * from './views'
export * from './AccountBalanceQuery'
export * from './BalanceTimeSeriesQuery'
```

- [ ] **Step 4: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add packages/domain/src/balance-asset-tracking/queries/
git commit -m "feat(domain/balance-asset-tracking): Query I/F 2 種と queries barrel を追加"
```

---

## Task 28: 残高・資産推移管理のドメインイベント 4 種 + barrel

**Files:**
- Create: `packages/domain/src/balance-asset-tracking/events/AccountBalanceUpdated.ts`
- Create: `packages/domain/src/balance-asset-tracking/events/UnpaidBookkept.ts`
- Create: `packages/domain/src/balance-asset-tracking/events/UnpaidSettled.ts`
- Create: `packages/domain/src/balance-asset-tracking/events/NisaContributionAdded.ts`
- Create: `packages/domain/src/balance-asset-tracking/events/index.ts`

- [ ] **Step 1: AccountBalanceUpdated.ts を作成**

```ts
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const AccountBalanceUpdatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AccountBalanceUpdated'),
  accountId: AccountIdSchema,
  delta: MoneySchema,
  newBalance: MoneySchema,
})
export type AccountBalanceUpdated = z.infer<typeof AccountBalanceUpdatedSchema>
```

- [ ] **Step 2: UnpaidBookkept.ts を作成**

```ts
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  MitsuiSumitomoUnpaidIdSchema,
  UnpaidEntryIdSchema,
  TransactionIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const UnpaidBookkeptSchema = DomainEventBaseSchema.extend({
  type: z.literal('UnpaidBookkept'),
  unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema,
  entryId: UnpaidEntryIdSchema,
  transactionId: TransactionIdSchema,
  bookedAmount: MoneySchema,
})
export type UnpaidBookkept = z.infer<typeof UnpaidBookkeptSchema>
```

- [ ] **Step 3: UnpaidSettled.ts を作成**

```ts
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  MitsuiSumitomoUnpaidIdSchema,
  UnpaidEntryIdSchema,
  SettlementNoticeIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const UnpaidSettledSchema = DomainEventBaseSchema.extend({
  type: z.literal('UnpaidSettled'),
  unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema,
  settledEntryIds: z.array(UnpaidEntryIdSchema),
  settlementNoticeId: SettlementNoticeIdSchema,
  settledTotal: MoneySchema,
})
export type UnpaidSettled = z.infer<typeof UnpaidSettledSchema>
```

- [ ] **Step 4: NisaContributionAdded.ts を作成**

```ts
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { BrokerageNameSchema } from '../value-objects/BrokerageName'

export const NisaContributionAddedSchema = DomainEventBaseSchema.extend({
  type: z.literal('NisaContributionAdded'),
  accountId: AccountIdSchema,
  addedAmount: MoneySchema,
  newAccumulated: MoneySchema,
  brokerageName: BrokerageNameSchema,
})
export type NisaContributionAdded = z.infer<typeof NisaContributionAddedSchema>
```

- [ ] **Step 5: events/index.ts を作成**

```ts
export * from './AccountBalanceUpdated'
export * from './UnpaidBookkept'
export * from './UnpaidSettled'
export * from './NisaContributionAdded'
```

- [ ] **Step 6: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 7: コミット**

```bash
git add packages/domain/src/balance-asset-tracking/events/
git commit -m "feat(domain/balance-asset-tracking): ドメインイベント 4 種を追加"
```

---

## Task 29: balance-asset-tracking の barrel

**Files:**
- Create: `packages/domain/src/balance-asset-tracking/index.ts`

- [ ] **Step 1: index.ts を作成**

```ts
export * from './aggregates'
export * from './value-objects'
export * from './repositories'
export * from './queries'
export * from './events'
```

- [ ] **Step 2: typecheck を実行**

Run: `pnpm --filter @household/domain typecheck`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add packages/domain/src/balance-asset-tracking/index.ts
git commit -m "feat(domain/balance-asset-tracking): コンテキストの barrel を追加"
```

---

# Phase E: 統合・検証（Tasks 30-35）

## Task 30: ルート src/index.ts（全 barrel re-export）

**Files:**
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: src/index.ts を更新**

```ts
/**
 * @household/domain — Phase 4 公開 API
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §3.3
 */
export * from './shared'
export * from './household-analysis'
export * from './balance-asset-tracking'
```

- [ ] **Step 2: build を実行**

Run: `pnpm --filter @household/domain build`
Expected: `dist/` に成果物生成、エラーなし。

- [ ] **Step 3: 全テスト実行**

Run: `pnpm --filter @household/domain test`
Expected: 全テスト PASS（合計 約 40+ 件）。

- [ ] **Step 4: コミット**

```bash
git add packages/domain/src/index.ts
git commit -m "feat(domain): 公開 API barrel を完成"
```

---

## Task 31: import 解決確認用の smoke テスト

**Files:**
- Create: `packages/domain/tests/smoke/public-api.test.ts`

- [ ] **Step 1: smoke テストを書く**

`packages/domain/tests/smoke/public-api.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  // shared
  TransactionIdSchema,
  UserIdSchema,
  AccountIdSchema,
  MoneySchema,
  YearMonthSchema,
  ExpenseClassSchema,
  DomainEventBaseSchema,
  DomainError,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
  // household-analysis
  TransactionSchema,
  MonthlyReportSchema,
  ImportSourceSchema,
  ClassificationBasisSchema,
  ViewerContextSchema,
  ViewerRoleSchema,
  // balance-asset-tracking
  AccountSchema,
  MitsuiSumitomoUnpaidSchema,
  BankNameSchema,
  BrokerageNameSchema,
  brokerageNameToDisplay,
  // events
  MonthlyReportCsvConfirmedSchema,
  MonthlyReportFinalizedSchema,
  TransactionDeletedSchema,
  AccountBalanceUpdatedSchema,
  UnpaidBookkeptSchema,
  UnpaidSettledSchema,
  NisaContributionAddedSchema,
} from '../../src'

describe('@household/domain 公開 API', () => {
  it('全 schema / class が import できる', () => {
    // schema 群
    expect(TransactionIdSchema).toBeDefined()
    expect(UserIdSchema).toBeDefined()
    expect(AccountIdSchema).toBeDefined()
    expect(MoneySchema).toBeDefined()
    expect(YearMonthSchema).toBeDefined()
    expect(ExpenseClassSchema).toBeDefined()
    expect(DomainEventBaseSchema).toBeDefined()
    expect(TransactionSchema).toBeDefined()
    expect(MonthlyReportSchema).toBeDefined()
    expect(ImportSourceSchema).toBeDefined()
    expect(ClassificationBasisSchema).toBeDefined()
    expect(ViewerContextSchema).toBeDefined()
    expect(ViewerRoleSchema).toBeDefined()
    expect(AccountSchema).toBeDefined()
    expect(MitsuiSumitomoUnpaidSchema).toBeDefined()
    expect(BankNameSchema).toBeDefined()
    expect(BrokerageNameSchema).toBeDefined()
    expect(brokerageNameToDisplay).toBeDefined()
    expect(MonthlyReportCsvConfirmedSchema).toBeDefined()
    expect(MonthlyReportFinalizedSchema).toBeDefined()
    expect(TransactionDeletedSchema).toBeDefined()
    expect(AccountBalanceUpdatedSchema).toBeDefined()
    expect(UnpaidBookkeptSchema).toBeDefined()
    expect(UnpaidSettledSchema).toBeDefined()
    expect(NisaContributionAddedSchema).toBeDefined()
    // class 群
    expect(DomainError).toBeDefined()
    expect(InvariantViolationError).toBeDefined()
    expect(NotFoundError).toBeDefined()
    expect(PermissionDeniedError).toBeDefined()
  })

  it('brokerageNameToDisplay が動作する', () => {
    expect(brokerageNameToDisplay({ kind: 'sbi' })).toBe('SBI証券')
    expect(brokerageNameToDisplay({ kind: 'rakuten' })).toBe('楽天証券')
    expect(brokerageNameToDisplay({ kind: 'other', customName: 'マネックス証券' })).toBe('マネックス証券')
  })

  it('NotFoundError が正しいメッセージを生成する', () => {
    const err = new NotFoundError('Transaction', 'tx_001')
    expect(err.message).toBe('Transaction not found: tx_001')
    expect(err.name).toBe('NotFoundError')
  })
})
```

- [ ] **Step 2: テスト実行**

Run: `pnpm --filter @household/domain test public-api`
Expected: PASS（3 件）。1 つでも import できなければ失敗する。

- [ ] **Step 3: コミット**

```bash
git add packages/domain/tests/smoke/public-api.test.ts
git commit -m "test(domain): 公開 API の import 解決確認 smoke テスト"
```

---

## Task 32: ビルドサイズと型出力確認

**Files:**
- なし（コマンド実行のみ）

- [ ] **Step 1: クリーンビルド**

Run: `rm -rf packages/domain/dist && pnpm --filter @household/domain build`
Expected: `packages/domain/dist/` 配下に `.js` と `.d.ts` が生成される。

- [ ] **Step 2: 型定義の確認**

Run: `ls packages/domain/dist/`
Expected: 以下のファイル群が存在
- `index.js`, `index.d.ts`
- `shared/`, `household-analysis/`, `balance-asset-tracking/` 配下に各サブディレクトリと型定義

Run: `head -30 packages/domain/dist/index.d.ts`
Expected: shared, household-analysis, balance-asset-tracking の `export * from` を含む。

- [ ] **Step 3: 検証コミット（dist は gitignore 済みなのでコミット不要、確認のみ）**

dist/ はコミット対象外。Step 1-2 が成功すればこのタスクは完了。

---

## Task 33: packages/domain/README.md（公開 API 一覧）

**Files:**
- Create: `packages/domain/README.md`

- [ ] **Step 1: README.md を作成**

```markdown
# @household/domain

Phase 4 戦術的設計で実装した家計分析・残高資産推移管理 2 コンテキストの TS 型 + Zod スキーマ + リポジトリ I/F + Query I/F。

> **親 spec**: [docs/superpowers/specs/2026-05-01-phase4-tactical-design.md](../../docs/superpowers/specs/2026-05-01-phase4-tactical-design.md)
> **plan**: [docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md](../../docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md)

## 公開 API（barrel: `@household/domain`）

### shared

- ID 型: `TransactionId`, `UserId`, `CategoryId`, `ExpenseTypeId`, `AccountId`, `MitsuiSumitomoUnpaidId`, `UnpaidEntryId`, `MonthlyReportId`, `ExpenseReimbursementId`, `SettlementNoticeId`, `GmailMessageId`（および各 Schema）
- 値オブジェクト: `Money`, `YearMonth`, `ExpenseClass`（および helper: `money`, `yearMonth`, `previousMonth`, `addMoney`, `subtractMoney`）
- イベント基底: `DomainEventBase`
- エラー: `DomainError`, `InvariantViolationError`, `NotFoundError`, `PermissionDeniedError`

### household-analysis（家計分析）

- 集約: `Transaction`（discriminated union: `unclassified` / `classified` / `deleted`）, `MonthlyReport`（`csv_confirmed` / `finalized`）
- 値オブジェクト: `ImportSource`, `ClassificationBasis`
- Repository I/F: `TransactionRepository`, `MonthlyReportRepository`
- Query I/F: `DashboardQuery`, `MonthlyReportQuery`, `TransactionListQuery`
- View 型: `DashboardKpisView`, `CategoryBreakdownView`, `MonthlyReportView`, `TransactionListItem`
- プライバシー: `ViewerContext`, `ViewerRole`（`applyPrivacyFilter` 関数群は内部実装、Query 実装層からのみ使用）
- ドメインイベント: `MonthlyReportCsvConfirmed`, `MonthlyReportFinalized`, `TransactionDeleted`

### balance-asset-tracking（残高・資産推移管理）

- 集約: `Account`（`smbc_bank` / `mitsui_sumitomo_card` / `other_savings` / `nisa`）, `MitsuiSumitomoUnpaid`
- 値オブジェクト: `BankName`, `BrokerageName`（および `brokerageNameToDisplay`）
- Repository I/F: `AccountRepository`, `MitsuiSumitomoUnpaidRepository`
- Query I/F: `AccountBalanceQuery`, `BalanceTimeSeriesQuery`
- View 型: `AccountBalanceListView`, `BalanceTimeSeriesView`, `AssetTotalView`
- ドメインイベント: `AccountBalanceUpdated`, `UnpaidBookkept`, `UnpaidSettled`, `NisaContributionAdded`

## 利用例

```ts
import {
  TransactionSchema,
  type Transaction,
  type TransactionRepository,
  type DashboardQuery,
} from '@household/domain'

// 集約の生成
const tx: Transaction = TransactionSchema.parse({
  kind: 'unclassified',
  common: {
    transactionId: '01HXYZ...',
    ownerUserId: '01ABCD...',
    merchantName: 'スーパーA',
    amount: 1500,
    occurredAt: new Date(),
    importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: '01ABCD...' },
  },
  reason: 'merchant_rule_unlearned',
  defaultExpenseClass: 'personal_honey',
})

// Repository 利用（実装は Phase 5 の adapter 層）
async function example(repo: TransactionRepository) {
  await repo.save(tx)
  const found = await repo.findById(tx.common.transactionId)
}
```

## 開発コマンド

```bash
pnpm install              # 依存関係インストール
pnpm --filter @household/domain build      # TS ビルド
pnpm --filter @household/domain test       # Vitest 実行
pnpm --filter @household/domain typecheck  # tsc --noEmit
pnpm --filter @household/domain lint       # ESLint
```

ルートから一括:
```bash
pnpm build       # 全 workspace ビルド
pnpm test        # 全 workspace テスト
pnpm typecheck   # 全 workspace 型チェック
pnpm lint        # 全 workspace lint
```

## Phase 5 への引き継ぎ

- 残り 6 コンテキスト（取引取込 / 自動分類・学習 / 経費精算 / オンボーディング・認証 / 通知配信 / マスタ管理）の型化
- adapter 層の実装（`packages/adapters-*`）
- LIFF アプリ（`packages/web`）と Lambda handlers（`packages/api`）の追加
- ドメインイベントバスの実装（Phase 4 では型定義のみ）
- 詳細: [Phase 4 spec §13](../../docs/superpowers/specs/2026-05-01-phase4-tactical-design.md)
```

- [ ] **Step 2: コミット**

```bash
git add packages/domain/README.md
git commit -m "docs(domain): @household/domain の README を追加"
```

---

## Task 34: DoD 検証 — 全 8 項目チェック

**Files:**
- なし（コマンド実行と確認のみ）

- [ ] **Step 1: D-1 ルート `pnpm install` 成功**

Run: `pnpm install`
Expected: エラーなし、`pnpm-lock.yaml` 更新なし（既に lock 済み）。

- [ ] **Step 2: D-2 `pnpm -r build` 成功**

Run: `pnpm -r build`
Expected: `packages/domain/dist/` に成果物、エラーなし。

- [ ] **Step 3: D-3 `pnpm -r typecheck` 成功**

Run: `pnpm -r typecheck`
Expected: エラーなし（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）。

- [ ] **Step 4: D-4 `pnpm -r test` 全 green**

Run: `pnpm -r test`
Expected: 以下のテスト全 PASS:
- `tests/shared/value-objects/Money.test.ts`（6 件）
- `tests/shared/value-objects/YearMonth.test.ts`（8 件）
- `tests/household-analysis/aggregates/Transaction.test.ts`（7 件）
- `tests/household-analysis/aggregates/MonthlyReport.test.ts`（4 件）
- `tests/household-analysis/privacy/applyPrivacyFilter.test.ts`（11 件）
- `tests/balance-asset-tracking/aggregates/Account.test.ts`（6 件）
- `tests/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid.test.ts`（4 件）
- `tests/smoke/public-api.test.ts`（3 件）
- 合計 49 件以上の PASS

- [ ] **Step 5: D-5 `pnpm -r lint` エラーゼロ**

Run: `pnpm -r lint`
Expected: エラー 0、警告も 0 が望ましい。

- [ ] **Step 6: D-6 公開 API export 一覧確認**

`packages/domain/tests/smoke/public-api.test.ts` がすべて PASS していれば D-6 は満たされている（Task 31 / Step 2 で確認済み）。

追加で目視確認:

Run: `cat packages/domain/src/index.ts`
Expected: `export * from './shared'`, `'./household-analysis'`, `'./balance-asset-tracking'` の 3 行が存在。

- [ ] **Step 7: D-7 各ファイル冒頭の DDD docs リンク確認**

Run: `grep -l "@see docs/" packages/domain/src/**/*.ts | wc -l`
Expected: 主要ファイル（集約・値オブジェクト・Query I/F 等）に `@see` コメントが存在することを確認。10+ ファイルでヒットすれば OK。

- [ ] **Step 8: D-8 README.md の存在確認**

Run: `ls packages/domain/README.md`
Expected: ファイル存在、Task 33 で作成済み。

- [ ] **Step 9: 全体最終確認とコミット**

D-1 〜 D-8 すべて green であることを確認。確認用に「Phase 4 DoD 達成」を空コミットで記録（git log で達成点を辿るため）。

```bash
git commit --allow-empty -m "chore(domain): Phase 4 DoD 8 項目すべて達成

D-1: pnpm install 成功
D-2: pnpm -r build 成功
D-3: pnpm -r typecheck 成功（strict + noUncheckedIndexedAccess）
D-4: pnpm -r test 全 green（49+ tests）
D-5: pnpm -r lint エラーゼロ
D-6: 公開 API smoke テスト緑
D-7: 各ファイルに @see DDD docs リンクあり
D-8: packages/domain/README.md 存在"
```

---

## 完了状態

すべてのタスク完了時点で以下が達成される:

- pnpm workspace モノレポが新規構築され、`packages/domain/` が独立パッケージとして動作
- 家計分析の集約（Transaction / MonthlyReport）と残高・資産推移管理の集約（Account / MitsuiSumitomoUnpaid）が Zod スキーマ + TS 型として完備
- Repository / Query / View 型 / プライバシーフィルタ / イベント型がすべて Phase 4 spec の通り実装
- Vitest テストで集約の不変条件と viewer × 所有者 × 費用区分のプライバシーマトリクスが網羅検証される
- `@household/domain` パッケージが Phase 5 の adapter 層・LIFF アプリ・Lambda handlers の依存先として利用可能になっている

Phase 5 で追加すべきもの（spec §13 参照）:
- 残り 6 コンテキストの型化
- adapter 層実装
- `packages/web` / `packages/api` の追加
- ドメインイベントバスの実配信
