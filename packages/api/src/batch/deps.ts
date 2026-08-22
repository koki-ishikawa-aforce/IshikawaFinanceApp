/**
 * バッチ用の依存合成（#416）
 *
 * API サーバと同じ `createDeps` を通す。バッチ専用の合成を別に作ると、リポジトリ実装や
 * ゲートウェイの選び方（本番の Neon / ローカルの素の PostgreSQL、Parameter Store の有無）が
 * 2 か所に分かれ、片方だけ直された状態に気づけない。
 *
 * ただし `createDeps` は DATABASE_URL が無いとインメモリのモック合成へ落ちる（開発用の逃げ道。
 * 本番判定は NODE_ENV だけで、Lambda ランタイムはこれを自動では設定しない）。定時起動が
 * モック合成で走ると、対象者が 1 人も居ない空のデータに対して 3 ジョブとも「成功」で終わり、
 * エラーにも上がらないまま「カード利用が家計簿に出てこない」「経費の当月累計が積まれない」だけが
 * 残る。定時起動の経路（`loadBatchDeps`）ではモック合成を禁じ、設定漏れを初回の失敗で表に出す。
 * モックで動かせるのは手動起動（`loadLocalBatchDeps`）だけにする。
 *
 * イベントハンドラーの購読も API と同じものを張る（`registerEventHandlers`）。張り忘れると、
 * バッチが発行したドメインイベントの後続処理だけがバッチ経路で動かない（API 経由では動くため
 * 気づきにくい）。現時点でバッチが発行するイベント（`TransactionCandidateExtracted` /
 * `MailImportBatchCompleted` / `MonthlyExpenseCycleStarted`）に購読者は無い。購読者を足すときは、
 * `safeSubscribe` 配下の失敗がログだけで済み、しかも翌日の再走査は重複除外・`already_started` で
 * イベントを出し直さない（= 再実行では回収できない）ことに注意する（#484 と同じ構図）。
 */
import {
  compositionEnvFromEnvironment,
  createDeps,
  type AppDeps,
  type CompositionEnv,
} from '../composition-root.js'
import { registerEventHandlers } from '../event-handlers/index.js'

export interface BatchDepsOptions {
  /**
   * DATABASE_URL 未設定のときにモック合成へ落ちることを許すか（既定 false）。
   * 手動起動でだけ true にする — 定時起動が空のモックデータを黙って処理するのを防ぐ。
   */
  allowMockFallback?: boolean | undefined
}

/** バッチが使う依存を合成する（API と同じ合成 + 同じイベント購読） */
export async function createBatchDeps(
  env: CompositionEnv,
  options: BatchDepsOptions = {},
): Promise<AppDeps> {
  if (!env.DATABASE_URL && options.allowMockFallback !== true) {
    throw new Error(
      'DATABASE_URL is required for scheduled batches. Refusing to run against in-memory mock data — a batch that "succeeds" against empty mocks looks identical to a healthy run.',
    )
  }
  const deps = await createDeps(env)
  registerEventHandlers(deps)
  return deps
}

let cached: Promise<AppDeps> | undefined

/**
 * 定時起動が使う依存を返す（プロセス内で 1 度だけ組み立てる）。
 *
 * Lambda は同じ実行環境を次の起動でも使い回すため、DB クライアントや Parameter Store の
 * クライアントを毎回作り直すと接続の作り直しぶんだけ遅くなる。合成が**失敗した**場合は
 * キャッシュを捨て、次の起動でやり直せるようにする（設定の入れ替え後も再起動を待たずに回復する）。
 * 合成が返ってこない（保留のまま）場合はこの回復が効かず、同じ実行環境の以降の起動も
 * 上限時間で失敗し続ける — 実行環境が入れ替わるまでは回復しない。
 */
export function loadBatchDeps(): Promise<AppDeps> {
  if (cached === undefined) {
    cached = createBatchDeps(compositionEnvFromEnvironment()).catch((e: unknown) => {
      cached = undefined
      throw e
    })
  }
  return cached
}

/**
 * 手動起動が使う依存を返す。DATABASE_URL が無ければモック合成で動かす
 * （画面もデータも用意せずに起動口の疎通だけ確かめられるようにする）。
 * 実行のたびに組み立てる（1 回で終わるプロセスのためキャッシュの意味が無い）。
 */
export function loadLocalBatchDeps(): Promise<AppDeps> {
  return createBatchDeps(compositionEnvFromEnvironment(), { allowMockFallback: true })
}
