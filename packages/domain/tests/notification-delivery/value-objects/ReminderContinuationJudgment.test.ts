import { describe, it, expect } from 'vitest'
import {
  REMINDER_START_DAY_OF_MONTH,
  ReminderContinuationJudgmentSchema,
  combineReminderJudgments,
  judgeReminderContinuation,
  type ReminderContinuationJudgment,
} from '../../../src/notification-delivery/value-objects/ReminderContinuationJudgment'

const judgedAt = new Date('2026-07-05T00:00:00Z')

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

  it('返り値はスキーマを満たす（継続には停止理由が付かない）', () => {
    const judgment = judgeReminderContinuation(
      { csvImportCompleted: false, notificationEnabled: true },
      judgedAt,
    )
    expect(ReminderContinuationJudgmentSchema.parse(judgment)).toEqual(judgment)
    expect(judgment).not.toHaveProperty('stopReason')
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
    expect(combineReminderJudgments([stoppedByImport, cont], judgedAt)).toEqual(cont)
  })

  it('全員が停止なら停止する', () => {
    expect(combineReminderJudgments([stoppedByImport, stoppedByImport], judgedAt)).toEqual(
      stoppedByImport,
    )
  })

  it('全員停止のとき、停止理由は先頭の判定のものを引き継ぐ', () => {
    expect(combineReminderJudgments([stoppedByDisabled, stoppedByImport], judgedAt).kind).toBe(
      'stop',
    )
    expect(combineReminderJudgments([stoppedByDisabled, stoppedByImport], judgedAt)).toEqual(
      stoppedByDisabled,
    )
  })

  it('判定が 1 件も無ければ停止する（催促する相手が居ない）', () => {
    const combined = combineReminderJudgments([], judgedAt)
    expect(combined.kind).toBe('stop')
  })
})

describe('REMINDER_START_DAY_OF_MONTH', () => {
  it('配信開始日は当月 5 日（08g §2 の事前条件）', () => {
    expect(REMINDER_START_DAY_OF_MONTH).toBe(5)
  })
})
