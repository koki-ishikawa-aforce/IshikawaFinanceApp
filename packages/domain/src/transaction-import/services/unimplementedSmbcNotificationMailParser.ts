/**
 * SMBC 通知メールのパース未実装版（#415 が実パースルールを入れるまでの差し替え先）
 *
 * 日次メール取込ワーカー（#414）は「取得 → パース → 候補生成 → 完了」を通す側で、本文の読み方は
 * 持たない。実メールのフォーマットに沿ったパース（#415）が入るまでは、どのメールも
 * 「パースできなかった」として扱う。
 *
 * ここで例外を投げたり取得自体を失敗にしたりしないのは、取込の進行を止めないため。パース失敗は
 * `MailParseFailed` として 1 通ずつ記録され、取り込めなかったメールが件数で分かる。Gmail message ID は
 * 取引候補として保存されないので、#415 が入ったあとの再走査（過去 5 日、OQ-31）で同じメールが
 * 取り込まれる。
 */
import { SmbcMailParseResultSchema } from '../value-objects/SmbcMailParseResult'
import type { SmbcNotificationMailParser } from './SmbcNotificationMailParser'

export function createUnimplementedSmbcMailParser(): SmbcNotificationMailParser {
  return ({ mail, at }) =>
    SmbcMailParseResultSchema.parse({
      kind: 'parse_failure',
      gmailMessageId: mail.gmailMessageId,
      // 本文の構造を読む実装がまだ無い。構造不一致・必須フィールド欠落のいずれとも言えないため other
      reason: 'other',
      detectedAt: at,
    })
}
