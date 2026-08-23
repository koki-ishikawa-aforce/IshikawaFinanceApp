/**
 * 勤務先振込元名簿集約（残高・資産推移管理コンテキスト、#448 / OQ-61）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1 §2
 * @see docs/domain/03-open-questions.md OQ-61
 *
 * kawasima:
 *   data 勤務先振込元名簿 = 利用者ID AND List<勤務先振込元名登録>
 *   data 勤務先振込元名登録 = 正規化済み振込元名 AND 表示用振込元名 AND 登録日時 AND 由来取引ID
 *
 * 入金用途判別（`determineBankDepositPurpose`）の入口にあたる「勤務先振込元名パターン」の
 * 保管先。OQ-61 の決定により**利用者ごと**に持つ（世帯にひとつだと夫婦の勤務先が別々のとき、
 * 片方の給与が毎回手動確認待ちに落ちる）。
 *
 * 登録経路は「実際に届いた入金から候補を出して選んでもらう」1 本に閉じる（OQ-61 ①）。
 * 用途が分からなかった入金を本人が確定する窓口（#390）で確定したときに、その入金の
 * 振込元名をこの名簿へ足す。設定画面での手入力は作らない。
 *
 * 不変条件:
 *  - 名簿の所有者本人だけが登録できる（給与・経費精算入金と同じく個人に閉じる情報。
 *    勤務先の振込元名は相手に見せない — プライバシー3段階ルール）
 *  - 登録できるのは勤務先からの入金として確定した入金（給与判別 / 経費精算入金判別）の
 *    振込元だけ。別銀行戻しの振込元を勤務先として登録すると、以後その口座間の資金移動が
 *    給与・経費精算として判別され、家計の集計が壊れる
 *  - 正規化済み振込元名で一意（同じ勤務先を二重に持たない）。同じ名前の再登録は冪等で、
 *    初回の登録日時・表示用の名前を据え置く
 */
import { z } from 'zod'
import { TransactionIdSchema, UserIdSchema, type UserId } from '../../shared/ids'
import { InvariantViolationError, PermissionDeniedError } from '../../shared/errors/DomainError'
import { normalizeRemitterName } from '../value-objects/NormalizedRemitterName'
import type { DeterminedBankDeposit } from './BankDeposit'

export const EmployerRemitterEntrySchema = z.object({
  /** 照合に使う正規化済みの名前（NFKC + 長音統一 + 空白圧縮、OQ-7） */
  normalizedName: z.string().min(1),
  /**
   * 明細に載っていた生の表記。利用者が自分の明細と突き合わせられるよう、
   * 登録のもとになった入金の振込元名をそのまま残す
   */
  displayName: z.string().min(1),
  registeredAt: z.date(),
  /** 登録のもとになった入金の取引ID（あとから「どの入金で登録したか」を辿れるようにする） */
  sourceTransactionId: TransactionIdSchema,
})
export type EmployerRemitterEntry = z.infer<typeof EmployerRemitterEntrySchema>

export const EmployerRemitterDirectorySchema = z.object({
  userId: UserIdSchema,
  entries: z.array(EmployerRemitterEntrySchema).superRefine((entries, ctx) => {
    const names = entries.map(e => e.normalizedName)
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '勤務先振込元名は正規化済みの名前で一意である必要があります',
      })
    }
  }),
})
export type EmployerRemitterDirectory = z.infer<typeof EmployerRemitterDirectorySchema>

/** 未登録の名簿。Repository は行が 1 件も無い利用者にこれを返す */
export function emptyEmployerRemitterDirectory(userId: UserId): EmployerRemitterDirectory {
  return EmployerRemitterDirectorySchema.parse({ userId, entries: [] })
}

/**
 * 名簿を閲覧できるか（プライバシー3段階ルール: 勤務先の振込元名は個人に閉じる）。
 *
 * Repository は本人分だけを引く前提だが、判定をドメイン側にも置いて
 * 呼び出し側の絞り込み漏れが露出にならないようにする（`canViewBankDeposit` と同じ構え）。
 */
export function canViewEmployerRemitterDirectory(
  directory: EmployerRemitterDirectory,
  viewerId: UserId,
): boolean {
  return directory.userId === viewerId
}

/** 判別に使う勤務先振込元名パターン（正規化済み）を取り出す */
export function employerRemitterNamesOf(directory: EmployerRemitterDirectory): string[] {
  return directory.entries.map(e => e.normalizedName)
}

/** 名簿に既に載っている振込元名か（正規化して照合する） */
export function isRegisteredEmployerRemitter(
  directory: EmployerRemitterDirectory,
  remitterName: string,
): boolean {
  return employerRemitterNamesOf(directory).includes(normalizeRemitterName(remitterName))
}

/**
 * behavior 勤務先振込元名を確定済み入金から登録する（08d §2、#448 / OQ-61）
 *
 * 事前: 操作者 = 名簿の所有者本人 かつ 入金の帰属ユーザー本人
 * 事前: 入金の用途 = 給与判別 または 経費精算入金判別（勤務先からの入金として確定済み）
 * 事後: 正規化済み振込元名が名簿に載る。以後の自動判別は勤務先入金として扱う
 * 事後: 既に載っている振込元名の再登録は冪等（同じ名簿をそのまま返す）
 *
 * 冪等にするのは、確定の再実行（同じ用途での確定し直し。反映の前方回復の入口）で
 * この登録も再び通るため。登録日時を振り直すと「いつ覚えたか」の記録が上書きされる。
 */
export function registerEmployerRemitterFromDeposit(
  directory: EmployerRemitterDirectory,
  params: { deposit: DeterminedBankDeposit; operatorUserId: UserId; at: Date },
): EmployerRemitterDirectory {
  const { deposit, operatorUserId } = params
  if (directory.userId !== operatorUserId || deposit.common.userId !== operatorUserId) {
    throw new PermissionDeniedError(
      `勤務先振込元名を登録できるのは名簿の所有者本人のみ（${directory.userId}）`,
    )
  }
  if (deposit.kind !== 'salary' && deposit.kind !== 'expense_reimbursement') {
    throw new InvariantViolationError(
      `勤務先振込元名として登録できるのは給与・経費精算入金として確定した入金のみ（${deposit.kind}）`,
    )
  }

  const normalizedName = normalizeRemitterName(deposit.common.remitterName)
  if (employerRemitterNamesOf(directory).includes(normalizedName)) return directory

  return EmployerRemitterDirectorySchema.parse({
    userId: directory.userId,
    entries: [
      ...directory.entries,
      {
        normalizedName,
        displayName: deposit.common.remitterName,
        registeredAt: params.at,
        sourceTransactionId: deposit.common.transactionId,
      },
    ],
  })
}
