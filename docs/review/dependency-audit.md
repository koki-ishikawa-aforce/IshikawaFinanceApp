# 依存脆弱性スキャン(pnpm audit)の運用

CI の `pnpm audit` ステップの失敗基準・除外方針・main が赤くなったときの手順。

> 関連: [レビュー観点の体系](./README.md) §4、`.github/workflows/ci.yml`、`package.json` の `pnpm.overrides` / `pnpm.auditConfig`

## 1. 失敗基準

```
pnpm audit --audit-level moderate
```

**moderate 以上の既知脆弱性が 1 件でもあれば CI を落とす。**

この閾値にした理由:

- 割まるは個人の金融データ(取引明細・残高・メールアドレス)を扱う。既知の脆弱性を「気づかないまま放置している」状態を作りたくない
- 導入時点(2026-07-25)で **moderate 以上を 0 件にできた**ため、`high` に緩める必要が無かった。0 件を維持できる基準を選ぶのが最も強い
- `low` にはしない。low は情報系の指摘が多く実質的に対応不能なものが混ざるため、CI が慢性的に赤くなり「`|| true` で握りつぶす」圧力を生む

閾値を緩める(`high` 等に変更する)場合は、緩める理由と再評価時期を §3 の表と同じ粒度で本ドキュメントに記録する。

## 2. CI 上の位置

`lint` と `format:check` の間に置く。`build` / `test` の後段であり、失敗は他ステップと同様にジョブを落とす(ソフト失敗にしない)。

`audit` を install 直後に置かない理由: このスキャンは npm レジストリの advisory データベースに問い合わせるため、**コード変更が無くても上流で新しい advisory が公開された瞬間に main が赤くなる**。前段に置くと build / test の結果すら得られなくなるため、他の検証結果が出揃った後段に置く。

## 3. 除外(ignore)の対象と理由

除外は `package.json` の `pnpm.auditConfig.ignoreGhsas` で宣言する。**`|| true` や `continue-on-error` で握りつぶさない。**

```json
"pnpm": {
  "auditConfig": {
    "ignoreGhsas": []
  }
}
```

| GHSA | パッケージ | 重大度 | 除外理由 | 再評価時期 |
| --- | --- | --- | --- | --- |
| — | — | — | 現在、除外している脆弱性はない | — |

除外を追加するときは、必ず以下 3 点を書く。

1. **除外理由** — 「まだ直っていない」ではなく「なぜこのプロジェクトでは攻撃面にならないか」を書く。到達不能である根拠(dev 依存のみ・該当 API を呼んでいない・本番構成に含まれない)を具体的に示す
2. **再評価時期** — 「パッチ公開待ち」で無期限にしない。日付か、追跡する Issue 番号を書く
3. **代替緩和策** — あれば書く(オーバーライド・設定変更等)

## 4. 修正の優先順(除外の前に試すこと)

除外は最後の手段。順に試す。

1. **依存範囲内のパッチ更新** — `pnpm why <pkg>` で経路を確認し、直接依存なら `package.json` のレンジを patched 版まで上げる
2. **`pnpm.overrides` で推移的依存を固定** — 直接依存でない場合。メジャーを跨がない範囲なら副作用が小さい。メジャーを跨ぐ場合は必ず検証一式 + 統合テスト + VRT で確認する
3. **メジャー更新** — 上記で解決しない場合。別 Issue に切り出してよいが、切り出したなら §3 の表に「その Issue 番号を再評価時期として」記録する
4. **除外** — 1〜3 がいずれも取れない場合のみ

### 導入時(2026-07-25)に行った修正

導入時点の main は **23 件(critical 1 / high 13 / moderate 12)** を検出した。以下で 0 件にした。

| 対応 | 内容 | 解消した advisory |
| --- | --- | --- |
| 直接依存のレンジ更新 | `next` を `^15.3.0` → `^15.5.21`(解決版は 15.5.20 だった) | next 系 8 件(high 3 / moderate 5) |
| 直接依存のメジャー更新 | `vitest` / `@vitest/coverage-v8` を `^1.6.0` → `^3.2.6`、`@vitejs/plugin-react` を `^4.3.0` → `^5.0.0` | vitest critical 1 件 |
| 直接依存のメジャー更新 | `@hono/node-server` を `^1.11.0` → `^2.0.5`(利用しているのは `serve` のみ) | @hono/node-server moderate 1 件 |
| `pnpm.overrides` | `brace-expansion` → `^5.0.8`(1.x / 2.x に backport されていないため major 固定) | high 3 件 |
| `pnpm.overrides` | `js-yaml@4` → `^4.3.0`、`postcss@8` → `^8.5.18` | high 2 件 / moderate 2 件 |
| `pnpm.overrides` | `sharp` → `^0.35.0`(libvips 由来の CVE 群) | high 1 件 |
| `pnpm.overrides` | `vite` → `^6.4.3`(vitest 3 が vite 6 を受け付ける) | high 1 件 / moderate 2 件 |
| `pnpm.overrides` | `esbuild@0.18` → `^0.25.0`(drizzle-kit の推移的依存) | moderate 1 件 |

いずれも `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check`・統合テスト(194 件)・VRT(14 件)が green であることを確認済み。VRT のベースライン変更は発生していない。

## 5. main が赤くなったときの手順

新しい advisory の公開でコード変更なしに落ちることがある。慌てて除外に走らず、以下の順で進める。

1. `pnpm audit` をローカルで実行し、対象パッケージ・重大度・依存経路(`Paths`)を確認する
2. §4 の優先順で修正を試す。ローカルで `pnpm audit` が 0 件になることを確認する
3. 依存が変わったので **検証一式 + 統合テスト + VRT** を通す。ロックファイルの変更は必ず PR に含める
4. どうしても取れない場合のみ §3 の表に行を追加し、`ignoreGhsas` に GHSA ID を加える
