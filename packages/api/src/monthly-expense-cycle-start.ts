/**
 * 月次経費サイクルの開始（08e §2「月次経費サイクルをリセットする」）の一元適用
 *
 * 経費(会社)の当月累計は月ごとのサイクルに積まれる。月が替わったら、その月ぶんの
 * 集積中サイクルを夫婦それぞれに 1 つずつ用意する必要がある（04-scenario-a-monthly-cycle.md
 * の「月初の唯一のジョブ」）。本モジュールはその開始処理を、次の 2 つの起点から
 * 同じ形で呼べるようにまとめたもの:
 *
 *  - `POST /api/expense-settlement/cycles`（`routes/expense-settlement.ts`）— 手動開始
 *  - 月初のスケジューラ起動 — 世帯の全ユーザーぶんを一括で開始する
 *    （Lambda エントリポイントからの起動は #416）
 *
 * サイクルの生成そのものはドメイン関数 `startMonthlyExpenseCycle` が唯一の経路で、
 * 本モジュールは「既存を確かめる → 保存する → 発行する」の手続きだけを担う。
 *
 * 冪等性: 対象年月のサイクルが既にあるユーザーは作成も発行も行わない
 * （`already_started`）。月初バッチのリトライや手動開始との重複起動で
 * サイクルが二重に作られることはない。存在確認と保存の間に別の経路が同じサイクルを
 * 作った場合（同時起動）は保存が一意制約違反になるが、これも `already_started` として
 * 扱う（結末が実際の状態と食い違わないようにする）。
 *
 * 既知の制約: 保存とイベント発行はトランザクションで括れない（Neon HTTP ドライバ方針）。
 * 保存後の発行失敗は再実行で回復しない（次回は `already_started` になる）ため、
 * 失敗はログに残して呼出し元へ返す。`MonthlyExpenseCycleStarted` の購読者は現時点で
 * 存在せず、取りこぼしても後続処理は止まらない。購読者を追加する時点で、この
 * at-most-once を許容するか出し直す経路を用意するかの判断が要る（#484 で切り出し済み）。
 */
import {
  InvariantViolationError,
  MonthlyExpenseCycleIdSchema,
  MonthlyExpenseCycleStartedSchema,
  UserRoleSchema,
  jstYearMonthOf,
  startMonthlyExpenseCycle,
  type AccumulatingCycle,
  type AppUserRepository,
  type EventBus,
  type MonthlyExpenseCycle,
  type MonthlyExpenseCycleId,
  type MonthlyExpenseCycleRepository,
  type UserId,
  type UserRole,
  type YearMonth,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { domainEventBase } from './event-handlers/index.js'

export interface MonthlyExpenseCycleStartDeps {
  monthlyExpenseCycleRepository: MonthlyExpenseCycleRepository
  eventBus: EventBus
}

export interface HouseholdMonthlyExpenseCycleStartDeps extends MonthlyExpenseCycleStartDeps {
  appUserRepository: AppUserRepository
}

/** 1 ユーザーぶんの開始結果（開始直後は必ず集積中。既存があれば `already_started`） */
export type MonthlyExpenseCycleStartResult =
  | { kind: 'started'; cycle: AccumulatingCycle }
  | { kind: 'already_started'; cycle: MonthlyExpenseCycle }

/**
 * 対象年月のサイクルが無ければ開始する（あれば何もしない）。
 *
 * 保存・発行の失敗はそのまま呼出し元へ伝播させる。世帯一括の経路
 * （`startMonthlyExpenseCyclesForHousehold`）は、これをユーザー単位で受け止めて
 * 他のユーザーの開始を続行する。
 */
export async function startMonthlyExpenseCycleForUser(
  deps: MonthlyExpenseCycleStartDeps,
  params: { userId: UserId; targetYearMonth: YearMonth; at?: Date },
): Promise<MonthlyExpenseCycleStartResult> {
  const at = params.at ?? new Date()
  const existing = await deps.monthlyExpenseCycleRepository.findByUserAndMonth(
    params.userId,
    params.targetYearMonth,
  )
  if (existing !== null) return { kind: 'already_started', cycle: existing }

  const cycle = startMonthlyExpenseCycle({
    monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema.parse(newUlid()),
    userId: params.userId,
    targetYearMonth: params.targetYearMonth,
    at,
  })
  try {
    await deps.monthlyExpenseCycleRepository.save(cycle)
  } catch (e) {
    // 「ユーザーID + 対象年月で一意」は DB の unique が最終保証で、上の存在確認と
    // この保存の間に別経路（手動開始と月初バッチの同時起動）が作ると一意違反になる。
    // 実際にはサイクルが存在するので、失敗ではなく `already_started` を返す
    if (e instanceof InvariantViolationError) {
      const concurrent = await deps.monthlyExpenseCycleRepository.findByUserAndMonth(
        params.userId,
        params.targetYearMonth,
      )
      if (concurrent !== null) return { kind: 'already_started', cycle: concurrent }
    }
    throw e
  }
  await deps.eventBus.publish(
    MonthlyExpenseCycleStartedSchema.parse({
      ...domainEventBase(at),
      type: 'MonthlyExpenseCycleStarted',
      monthlyExpenseCycleId: cycle.common.monthlyExpenseCycleId,
      userId: params.userId,
      targetYearMonth: params.targetYearMonth,
    }),
  )
  return { kind: 'started', cycle }
}

/** 世帯一括開始のユーザー単位の結末 */
export type HouseholdMemberCycleStartResult =
  | {
      role: UserRole
      status: 'started' | 'already_started'
      monthlyExpenseCycleId: MonthlyExpenseCycleId
    }
  /** その役割のユーザーが未登録（オンボーディング前）。開始対象が存在しない */
  | { role: UserRole; status: 'not_registered' }
  /**
   * 失敗の理由はエラー種別（`Error.name` 相当）だけを持つ。呼出し元が結果を通知本文や
   * 応答へそのまま載せても、DB エラーの内部情報（接続先・SQL・パラメータ・ユーザーID）が
   * 外へ出ないようにする。詳細はサーバログ側に残す。
   *
   * `stage` は再実行で回復するかを分ける:
   *  - `not_started`: サイクルは作られていない（または確認できなかった）。再実行で回復する
   *  - `event_publish`: サイクルは保存済みで開始イベントの発行だけが落ちた。再実行は
   *    `already_started` を返すため、**発行は自動では回復しない**
   */
  | {
      role: UserRole
      status: 'failed'
      failureKind: string
      stage: 'not_started' | 'event_publish'
    }

/**
 * 月初バッチの結果（スケジューラのログ・再実行判定用）。
 * 相手のサイクル ID を含むため、API 応答や利用者向けの通知には含めない
 * （経費精算は本人のみ可視・論点11）。
 */
export interface HouseholdMonthlyExpenseCycleStartOutcome {
  targetYearMonth: YearMonth
  results: HouseholdMemberCycleStartResult[]
}

/**
 * 世帯の全ユーザー（Honey / Darling）の当該月サイクルを開始する（月初バッチの本体）。
 *
 * 対象年月を省略すると、起動時刻から JST 暦の当月を採る。月初 00:0x JST は UTC ではまだ
 * 前月のため、UTC の暦で導出すると前月ぶんを開始して当月が空のまま残る。既定値を
 * ここに置いて、呼出し元（#416 のエントリポイント）で取り違えられないようにする。
 *
 * 1 人の失敗で他方の開始を巻き込まないよう、ユーザー単位で失敗を受け止めて続行する
 * （片方だけ経費を積めない月ができるより、開始できた側は開始しておくほうが被害が小さい）。
 * 失敗は握りつぶさず、記録したうえで結果に `failed` として残す。呼出し元
 * （スケジューラのエントリポイント）は `failed` を見て再実行・通報を判断する。
 *
 * ログに出すのは役割・対象年月・エラー種別だけ（ユーザーID は LINE userID = 個人を辿れる
 * 識別子のため出さない。DB ドライバの例外は文・パラメータに userId を抱えるため丸ごとは出さない）。
 */
export async function startMonthlyExpenseCyclesForHousehold(
  deps: HouseholdMonthlyExpenseCycleStartDeps,
  params: { targetYearMonth?: YearMonth; at?: Date } = {},
): Promise<HouseholdMonthlyExpenseCycleStartOutcome> {
  const at = params.at ?? new Date()
  const targetYearMonth = params.targetYearMonth ?? jstYearMonthOf(at)
  const results: HouseholdMemberCycleStartResult[] = []

  for (const role of UserRoleSchema.options) {
    try {
      const user = await deps.appUserRepository.findByRole(role)
      if (user === null) {
        // オンボーディング前は開始対象が存在しない（想定内）。ただし運用開始後に読めなく
        // なった場合も同じ見た目になり、片方の月次サイクルが丸ごと欠けたことに気づけない。
        // 通報レベルは上げずに、飛ばした事実だけは残す
        console.info(
          `[expense-settlement] 月次経費サイクルの開始対象がいないため飛ばした` +
            `（role=${role}, targetYearMonth=${targetYearMonth}）`,
        )
        results.push({ role, status: 'not_registered' })
        continue
      }
      const result = await startMonthlyExpenseCycleForUser(deps, {
        userId: user.common.userId,
        targetYearMonth,
        at,
      })
      results.push({
        role,
        status: result.kind,
        monthlyExpenseCycleId: result.cycle.common.monthlyExpenseCycleId,
      })
    } catch (e) {
      // 開始できなかった月は経費(会社)の当月累計が積まれない（利用者には「経費にしたのに
      // 集計されない」に見える）。無言で落とさず記録する。
      // 例外そのものは出さない — DB ドライバの例外は文・パラメータを抱えており、
      // そこに載る userId（= LINE userID）がログへ落ちる
      const failureKind = e instanceof Error ? e.name : 'unknown'
      const stage = await failureStageOf(deps, role, targetYearMonth)
      console.error(
        `[expense-settlement] 月次経費サイクルの開始に失敗した（role=${role}, ` +
          `targetYearMonth=${targetYearMonth}, error=${failureKind}, stage=${stage}）— ` +
          (stage === 'event_publish'
            ? 'サイクルは保存済みで開始イベントだけが出ていない（再実行では回復しない）。'
            : '再実行で開始をやり直せる。') +
          '他ユーザーの開始は継続する',
      )
      results.push({ role, status: 'failed', failureKind, stage })
    }
  }

  return { targetYearMonth, results }
}

/**
 * 失敗がどこで起きたかを、保存結果の状態から判定する（例外の中身には頼らない）。
 * サイクルが残っていれば保存は済んでおり、落ちたのは開始イベントの発行（再実行で回復しない）。
 * 判定のための読み出し自体が失敗した場合は、回復可能な側（`not_started`）に倒す
 * — 保存済みと誤って報告して「回復しない失敗」を増やすより、再実行を促すほうが安全。
 */
async function failureStageOf(
  deps: HouseholdMonthlyExpenseCycleStartDeps,
  role: UserRole,
  targetYearMonth: YearMonth,
): Promise<'not_started' | 'event_publish'> {
  try {
    const user = await deps.appUserRepository.findByRole(role)
    if (user === null) return 'not_started'
    const saved = await deps.monthlyExpenseCycleRepository.findByUserAndMonth(
      user.common.userId,
      targetYearMonth,
    )
    return saved === null ? 'not_started' : 'event_publish'
  } catch {
    return 'not_started'
  }
}
