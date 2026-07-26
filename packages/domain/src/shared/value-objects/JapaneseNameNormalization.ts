/**
 * 日本語の名称正規化（OQ-7 / OQ-23 の共通規約）
 *
 * NFKC 正規化 + カタカナ直後の長音統一 + 空白圧縮。取込経路（CSV / PDF / メール）や
 * 比較の用途（加盟店名の三項一致・振込元名のパターン照合）が違っても、同じ文字列が
 * 同じ形に寄らなければ照合そのものが成立しないため、アルゴリズムを 1 か所に置く。
 *
 * PDF や メールからの抽出では長音記号「ー」がハイフン類（‐ – — − 等）に化けることがあるため、
 * カタカナ直後のハイフン類を長音記号へ統一する。半角長音「ｰ」は NFKC が「ー」へ寄せる。
 *
 * 用途ごとの名前（`normalizeMerchantName` / `normalizeRemitterName`）は各コンテキストに
 * 置き、この関数へ委譲する。ユビキタス言語上は別の語なので名前は畳まない。
 */
export function normalizeJapaneseName(raw: string): string {
  const nfkc = raw.normalize('NFKC')
  const choonUnified = nfkc.replace(/(?<=[゠-ヿ])[-‐-―−]/g, 'ー')
  return choonUnified.replace(/\s+/g, ' ').trim()
}
