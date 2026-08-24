import { expect, type Page, type Response } from '@playwright/test'

/**
 * 撮影前に画面を安定させるヘルパー置き場(書体・開発オーバーレイ・取得の完了)。
 * 土台を 1 本にまとめるかは #574 で判断待ちのため、ここでは置き場を変えない。
 */

/** globals.css の --font-family 先頭に置かれた設計書体 */
export const DESIGN_FONT_FAMILY = 'Zen Maru Gothic'

/** 書体ロードを待つ上限。これを超えたら待つのをやめて先へ進む */
const FONT_LOAD_TIMEOUT_MS = 5000

/** 取得の完了を待つ上限。超えたらテストを落とす(書体と違い、待てなければ撮影は成立しない) */
const DATA_LOAD_TIMEOUT_MS = 30_000

/**
 * 画面のボタンに使われる書体をロードしてから撮影・検証できるようにする。
 *
 * Zen Maru Gothic は unicode-range で多数のサブセット @font-face に分割されており、
 * 使われる文字が決まって初めて対応するサブセットがロードされる。
 * `document.fonts.load()` は第 2 引数を省略するとラテンのサンプル文字列しか解決しないため、
 * ボタンのラベルに現れる代表的な文字を渡して日本語サブセットもロードさせる。
 *
 * フォーム要素がフォントを継承するようになった（#310）ことでボタンの行ボックス高が
 * この書体のメトリクスに依存するようになり、ロード完了前に撮影すると
 * レイアウトが数 px ずれた状態が写ってスナップショットが不安定になる。
 *
 * ページ上のテキスト全量を渡すと、含まれる文字種のぶんだけサブセットの取得が発生して
 * 環境によっては待ち時間が跳ね上がるため、渡す文字は固定の代表セットに絞る。
 * さらに、ロードが完了しない環境でもテストを止めないよう上限時間で打ち切る
 * （打ち切られた場合でもフォールバック書体で描画が続くだけで、検証自体は成立する）。
 */
export async function waitForAppFonts(page: Page): Promise<void> {
  await page.evaluate(
    async ([family, timeoutMs]) => {
      // ボタン・ナビ・見出しに現れる代表的な文字（サブセット数を抑えるため固定）
      const sample = '世帯個人今月支出取引残高精算取込設定前次年月日件円'
      const load = Promise.all(
        ['400', '500', '700'].map(weight =>
          document.fonts.load(`${weight} 16px "${family}"`, sample),
        ),
      ).then(() => document.fonts.ready)
      const timeout = new Promise(resolve => setTimeout(resolve, timeoutMs as number))
      await Promise.race([load, timeout])
    },
    [DESIGN_FONT_FAMILY, FONT_LOAD_TIMEOUT_MS] as const,
  )
}

/**
 * Next.js の開発オーバーレイ（左下のインジケーター）は実行ごとに状態が変わり
 * （折りたたみ / "N Issues" の展開）、スナップショット比較のノイズになるため隠す。
 */
export async function hideDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
}

/**
 * 画面の取得が終わってから撮影できるようにする。
 *
 * モック起動モードでは画面がサーバへ問い合わせないため `networkidle` は即座に成立し、
 * 取得結果が反映される前に撮影されうる。並列実行で混み合ったときだけ「読み込み中...」の
 * まま写るという再現しにくい形で現れ、`--update-snapshots` で撮り直すと**読み込み中の
 * 画面が基準になり**、その画面の中身が以後まったく見張られなくなる。
 *
 * 待つのは `LoadingState` の目印(`data-loading`)が画面から消えること。「0 件になった」が
 * 待ちとして意味を持つのは、目印が**サーバが返した HTML の時点で存在する**からで、
 * これが崩れると待ちは即座に成立して素通りする(ハイドレーション前に 0 件で通り、
 * 直後に「読み込み中」が現れる)。素通りに気づけるよう、遷移時のレスポンス本文に
 * 目印があることを併せて確かめる。
 */
export async function waitForDataLoaded(page: Page, response: Response | null): Promise<void> {
  const html = (await response?.text()) ?? ''
  expect(html, '取得中の目印がサーバの返す HTML に含まれている').toContain('data-loading')
  // 既定の 5 秒では、その画面を初めて開く実行(dev サーバのコンパイルを伴う)で足りない。
  // テスト全体の上限(60 秒)の内側で、取得の完了を待ち切れる長さにする
  await expect(page.locator('[data-loading]')).toHaveCount(0, { timeout: DATA_LOAD_TIMEOUT_MS })
}
