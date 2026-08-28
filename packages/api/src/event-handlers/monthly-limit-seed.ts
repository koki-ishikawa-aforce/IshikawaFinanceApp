/**
 * 役割確定 → 月次上限の seed 投入ハンドラー（#56 / 論点14 / OQ-19）
 *
 * `RoleJudged`（役割確定）を購読し、規定経費種別ぶんの月次上限を
 * ロール既定値で自動作成する（08h §2「月次上限をseed投入する」/ 08h §4
 * オンボーディング・認証との関係「Phase 1 役割確定時の自動紐付け」）。
 *
 * DB 初期化時の seed では実 LINE ユーザーID が未確定のため投入できず、
 * 役割が確定するこの時点が最初に「個人別」を決められる契機になる。
 *
 * 冪等性: 既に月次上限がある（userId + expenseTypeId）経費種別は飛ばすため、
 * 同一イベントの再配信でも二重作成しない。
 */
import {
  MonthlyLimitIdSchema,
  MonthlyLimitSeedInsertedSchema,
  defaultSeedLimitFor,
  seedMonthlyLimit,
} from '@warimaru/domain'
import type {
  EventBus,
  ExpenseTypeMasterRepository,
  MonthlyLimitRepository,
  RoleJudged,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { safeSubscribe } from './safe-subscribe.js'
import { domainEventBase } from './event-base.js'

export interface MonthlyLimitSeedHandlerDeps {
  expenseTypeMasterRepository: ExpenseTypeMasterRepository
  monthlyLimitRepository: MonthlyLimitRepository
}

export function registerMonthlyLimitSeedEventHandlers(
  eventBus: EventBus,
  deps: MonthlyLimitSeedHandlerDeps,
): void {
  safeSubscribe<RoleJudged>(eventBus, 'RoleJudged', async event => {
    // 役割拒否（許可リスト不一致）では紐付け先の個人が決まらないため何もしない
    if (event.result.kind !== 'accepted') return
    const { lineUserId: userId, role, judgedAt } = event.result

    const expenseTypes = await deps.expenseTypeMasterRepository.findAllVisibleToUser(userId)
    for (const expenseType of expenseTypes) {
      // 規定 5 種のみが seed 対象（追加経費種別の上限は設定画面で個別に新規設定する）
      if (expenseType.kind !== 'default') continue

      const existing = await deps.monthlyLimitRepository.findByUserAndExpenseType(
        userId,
        expenseType.expenseTypeId,
      )
      if (existing !== null) continue

      const seedLimit = defaultSeedLimitFor(role, expenseType.defaultKind)
      const monthlyLimitId = MonthlyLimitIdSchema.parse(newUlid())
      await deps.monthlyLimitRepository.save(
        seedMonthlyLimit({
          monthlyLimitId,
          userId,
          expenseTypeId: expenseType.expenseTypeId,
          seedLimit,
          seededAt: judgedAt,
        }),
      )
      await eventBus.publish(
        MonthlyLimitSeedInsertedSchema.parse({
          ...domainEventBase(judgedAt),
          type: 'MonthlyLimitSeedInserted',
          monthlyLimitId,
          userId,
          expenseTypeId: expenseType.expenseTypeId,
          seedLimit,
        }),
      )
    }
  })
}
