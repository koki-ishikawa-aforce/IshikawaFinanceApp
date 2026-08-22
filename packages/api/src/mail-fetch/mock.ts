/**
 * GmailMailFetchGateway のモック（DATABASE_URL 未設定の開発・テストモード用）
 *
 * 実 Gmail を呼ばず、常に「取得 0 件の成功」を返す。開発モードには Gmail OAuth トークンも
 * Parameter Store も無いため失敗を返す選択肢もあるが、日次メール取込の呼出し側（#414）を
 * 開発モードで動かしたときに、毎回「取得失敗」で止まるより、メールが 1 通も無い日と同じ
 * 経路を通すほうが確かめたい進行（取得 → パース → 候補生成 → 完了）に近い。
 */
import type { GmailMailFetchGateway } from '@warimaru/domain'

export function createMockGmailMailFetchGateway(): GmailMailFetchGateway {
  return {
    fetchMails: () => Promise.resolve({ ok: true, smbcMails: [], amazonMails: [] }),
  }
}
