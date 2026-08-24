/**
 * 画面が「今」として扱う日時。
 *
 * 通常は端末の現在時刻をそのまま返す。モック起動モード（`NEXT_PUBLIC_MOCK=1`）で
 * `NEXT_PUBLIC_MOCK_NOW` が指定されているときだけ、その日時を返す。
 *
 * 見た目の自動チェック（VRT）は月名・日付・「当月かどうか」で表示が変わる画面を撮るため、
 * 実時刻のままでは月が替わるたびに基準画像とずれていく。ずれは「画面全体の 1% 以内なら
 * 同じとみなす」許容量に吸収されて緑のまま通り、その許容量のぶんだけ日付と関係のない
 * 崩れも一緒に見逃せる状態になる。撮影時の「今」を固定してこのずれ自体を無くす（#506）。
 *
 * サーバー側の描画（`next dev` の SSR）とブラウザ側の描画が同じ「今」を見るよう、
 * ブラウザの時計ではなく環境変数で渡す。片方だけを固定すると初期 HTML と
 * ハイドレーション後で月がずれ、開発時のハイドレーション不一致になる。
 *
 * 固定値の出所は `src/mocks/clock.ts`（fixture が想定している「今」）。
 */
export function now(): Date {
  // 条件を直接 if に書くことで、通常ビルドでは process.env の畳み込みにより
  // if(false) となり、この分岐がデッドコード除去される（`api-client` と同じ書き方）。
  if (process.env.NEXT_PUBLIC_MOCK === '1') {
    const fixed = process.env.NEXT_PUBLIC_MOCK_NOW
    if (fixed !== undefined && fixed !== '') {
      const parsed = new Date(fixed)
      // 解釈できない値を返すと、日付を使う画面が一斉に `Invalid Date` を描画して
      // 原因が読めなくなる。指定ミスは実時刻へ落として画面を壊さない
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
  }
  return new Date()
}
