import type { Page } from '@playwright/test'

/** globals.css の --font-family 先頭に置かれた設計書体 */
export const DESIGN_FONT_FAMILY = 'Zen Maru Gothic'

/** 書体ロードを待つ上限。これを超えたら待つのをやめて先へ進む */
const FONT_LOAD_TIMEOUT_MS = 5000

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
