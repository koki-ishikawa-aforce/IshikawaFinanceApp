import type { Page } from '@playwright/test'

/** globals.css の --font-family 先頭に置かれた設計書体 */
export const DESIGN_FONT_FAMILY = 'Zen Maru Gothic'

/**
 * 画面に実際に描画されている文字ぶんの書体をロードしてから撮影・検証できるようにする。
 *
 * Zen Maru Gothic は unicode-range で多数のサブセット @font-face に分割されており、
 * 使われる文字が決まって初めて対応するサブセットがロードされる。
 * `document.fonts.load()` は第 2 引数を省略するとラテンのサンプル文字列しか解決しないため、
 * ページ上のテキストを渡して日本語サブセットまでロードさせる。
 *
 * フォーム要素がフォントを継承するようになった（#310）ことでボタンの行ボックス高が
 * この書体のメトリクスに依存するようになり、ロード完了前に撮影すると
 * レイアウトが数 px ずれた状態が写ってスナップショットが不安定になる。
 */
export async function waitForAppFonts(page: Page): Promise<void> {
  await page.evaluate(async family => {
    // 描画中のテキスト全量（空なら代表的な日本語を使う）
    const text = document.body.innerText.replace(/\s+/g, '') || '世帯個人今月支出'
    await Promise.all(
      ['400', '500', '700'].map(weight => document.fonts.load(`${weight} 16px "${family}"`, text)),
    )
    await document.fonts.ready
  }, DESIGN_FONT_FAMILY)
}

/**
 * Next.js の開発オーバーレイ（左下のインジケーター）は実行ごとに状態が変わり
 * （折りたたみ / "N Issues" の展開）、スナップショット比較のノイズになるため隠す。
 */
export async function hideDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
}
