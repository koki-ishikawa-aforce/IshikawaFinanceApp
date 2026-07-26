import { describe, it, expect } from 'vitest'
import { YearMonthSchema } from '../../../src/shared/value-objects/YearMonth'
import {
  REMINDER_START_DAY_OF_MONTH,
  ReminderContinuationJudgmentSchema,
  ReminderWindowSchema,
  combineReminderJudgments,
  judgeReminderContinuation,
  judgeReminderWindow,
  type ReminderContinuationJudgment,
} from '../../../src/notification-delivery/value-objects/ReminderContinuationJudgment'

const judgedAt = new Date('2026-07-05T00:00:00Z')
const july = YearMonthSchema.parse('2026-07')

describe('judgeReminderContinuation', () => {
  it('CSV 未取込 かつ 通知有効なら継続する（催促がまだ必要な状態）', () => {
    const judgment = judgeReminderContinuation(
      { csvImportCompleted: false, notificationEnabled: true },
      judgedAt,
    )
    expect(judgment).toEqual({ kind: 'continue', judgedAt })
  })

  it('CSV 取込完了なら csv_import_completed で停止する', () => {
    const judgment = judgeReminderContinuation(
      { csvImportCompleted: true, notificationEnabled: true },
      judgedAt,
    )
    expect(judgment).toEqual({ kind: 'stop', judgedAt, stopReason: 'csv_import_completed' })
  })

  it('通知機能が無効なら notification_disabled で停止する', () => {
    const judgment = judgeReminderContinuation(
      { csvImportCompleted: false, notificationEnabled: false },
      judgedAt,
    )
    expect(judgment).toEqual({ kind: 'stop', judgedAt, stopReason: 'notification_disabled' })
  })

  it('取込完了と通知無効が同時に成立する場合は csv_import_completed を理由にする', () => {
    const judgment = judgeReminderContinuation(
      { csvImportCompleted: true, notificationEnabled: false },
      judgedAt,
    )
    expect(judgment).toEqual({ kind: 'stop', judgedAt, stopReason: 'csv_import_completed' })
  })

  it('継続には停止理由が付かない', () => {
    const judgment = judgeReminderContinuation(
      { csvImportCompleted: false, notificationEnabled: true },
      judgedAt,
    )
    expect(judgment).not.toHaveProperty('stopReason')
  })
})

describe('ReminderContinuationJudgmentSchema', () => {
  it('理由の無い停止を拒否する（停止理由は ReminderStopped イベントに載って永続化される）', () => {
    expect(() => ReminderContinuationJudgmentSchema.parse({ kind: 'stop', judgedAt })).toThrow()
  })

  it('停止理由の語彙外の値を拒否する', () => {
    expect(() =>
      ReminderContinuationJudgmentSchema.parse({
        kind: 'stop',
        judgedAt,
        stopReason: 'unknown_reason',
      }),
    ).toThrow()
  })

  it('継続・停止以外の状態を拒否する', () => {
    expect(() => ReminderContinuationJudgmentSchema.parse({ kind: 'paused', judgedAt })).toThrow()
  })

  it('判定日時が Date でない値を拒否する', () => {
    expect(() =>
      ReminderContinuationJudgmentSchema.parse({ kind: 'continue', judgedAt: '2026-07-05' }),
    ).toThrow()
  })
})

describe('combineReminderJudgments', () => {
  const cont: ReminderContinuationJudgment = { kind: 'continue', judgedAt }
  const stoppedByImport: ReminderContinuationJudgment = {
    kind: 'stop',
    judgedAt,
    stopReason: 'csv_import_completed',
  }
  const stoppedByDisabled: ReminderContinuationJudgment = {
    kind: 'stop',
    judgedAt,
    stopReason: 'notification_disabled',
  }

  it('1 人でも継続なら世帯としては継続する（共通トークルームは宛先を分けられない）', () => {
    expect(combineReminderJudgments([stoppedByImport, cont])).toEqual(cont)
  })

  it('全員が停止なら停止する', () => {
    expect(combineReminderJudgments([stoppedByImport, stoppedByImport])).toEqual(stoppedByImport)
  })

  it('全員停止のとき、停止理由は先頭の判定のものを引き継ぐ', () => {
    expect(combineReminderJudgments([stoppedByDisabled, stoppedByImport])).toEqual(
      stoppedByDisabled,
    )
  })

  it('判定が 1 件も無ければ undefined を返す（事実と異なる停止理由を作らない）', () => {
    expect(combineReminderJudgments([])).toBeUndefined()
  })
})

describe('judgeReminderWindow', () => {
  it('当月 5 日以降なら配信期間内', () => {
    expect(judgeReminderWindow(july, new Date('2026-07-05T00:00:00Z'))).toEqual({ kind: 'open' })
  })

  it('当月 4 日は開始前（JST 基準）', () => {
    expect(judgeReminderWindow(july, new Date('2026-07-04T10:00:00Z'))).toEqual({
      kind: 'before_start_day',
      dayOfMonth: 4,
    })
  })

  it('JST で 5 日になった瞬間に配信期間へ入る', () => {
    expect(judgeReminderWindow(july, new Date('2026-07-04T15:00:00Z'))).toEqual({ kind: 'open' })
  })

  it('対象月が当月でなければ配信しない（スケジューラの指定ミスを弾く）', () => {
    expect(judgeReminderWindow(july, new Date('2026-08-10T00:00:00Z'))).toEqual({
      kind: 'not_current_month',
      currentMonth: '2026-08',
    })
  })

  it('対象月が当月でなければ、5 日より前かどうかに関わらず弾く', () => {
    expect(judgeReminderWindow(july, new Date('2026-08-02T00:00:00Z')).kind).toBe(
      'not_current_month',
    )
  })

  it('返り値はスキーマを満たす', () => {
    const window = judgeReminderWindow(july, new Date('2026-07-10T00:00:00Z'))
    expect(ReminderWindowSchema.parse(window)).toEqual(window)
  })
})

describe('REMINDER_START_DAY_OF_MONTH', () => {
  it('配信開始日は当月 5 日（08g §2 の事前条件）', () => {
    expect(REMINDER_START_DAY_OF_MONTH).toBe(5)
  })
})
