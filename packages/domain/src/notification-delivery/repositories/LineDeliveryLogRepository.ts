/**
 * LINE配信ログ Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.6
 *
 * append-only: ログは監査記録であり更新は禁止（save は新規保存のみ、Phase 5 M-B）。
 * 同月レポート再送信の重複防止は save 前の findAllByIdempotencyKey + concludedDeliveryOf で行う。
 * 送信失敗のログは配信を確定させないため、同一冪等性キーに複数件のログが並ぶ
 * （失敗の履歴 + 最終的に確定した 1 件、#441-A）。
 */
import type { DeliveryLogId } from '../../shared/ids'
import type { LineDeliveryLog } from '../aggregates/LineDeliveryLog'

export interface LineDeliveryLogRepository {
  findById(id: DeliveryLogId): Promise<LineDeliveryLog | null>
  /**
   * 同一冪等性キーのログを発生日時（deliveryLogOccurredAt）の昇順で全件返す。
   *
   * 順序をドメインが持つ日時で規定するのは、集約から検証できない adapter 固有の
   * 列（created_at）に契約を寄せないため。
   *
   * 配信を止めるかどうかの判定は呼出し側が concludedDeliveryOf で行う
   * （判定を adapter の SQL に持たせないため、絞り込みではなく全件を返す）。
   * 1 キーあたりの件数は 1 回の配信機会につき 1 件で、機会そのものが
   * 日次・月次に限られるため件数は小さく収まる。
   */
  findAllByIdempotencyKey(idempotencyKey: string): Promise<LineDeliveryLog[]>
  save(log: LineDeliveryLog): Promise<void>
}
