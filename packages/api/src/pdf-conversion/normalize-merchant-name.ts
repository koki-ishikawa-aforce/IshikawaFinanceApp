/**
 * 加盟店名の正規化（OQ-23: NFKC 正規化 + 空白圧縮 + 長音統一）
 *
 * PDF からの抽出では長音記号「ー」がハイフン類（‐ – — − 等）に化けることがあるため、
 * カタカナ直後のハイフン類を長音記号へ統一する。半角長音「ｰ」は NFKC が「ー」へ寄せる。
 * 既存取引との三項一致判定（findByTripleMatch、OQ-7）は正規化済み加盟店名を前提とする。
 */
export function normalizeMerchantName(raw: string): string {
  const nfkc = raw.normalize('NFKC')
  const choonUnified = nfkc.replace(/(?<=[゠-ヿ])[-‐-―−]/g, 'ー')
  return choonUnified.replace(/\s+/g, ' ').trim()
}
