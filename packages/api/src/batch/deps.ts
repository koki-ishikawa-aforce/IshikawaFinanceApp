/**
 * バッチ用の依存合成（#416）
 *
 * API サーバと同じ `createDeps` を通す。バッチ専用の合成を別に作ると、リポジトリ実装や
 * ゲートウェイの選び方（本番の Neon / ローカルの素の PostgreSQL、Parameter Store の有無）が
 * 2 か所に分かれ、片方だけ直された状態に気づけない。
 *
 * イベントハンドラーの購読も API と同じものを張る（`registerEventHandlers`）。バッチが発行した
 * ドメインイベントの後続処理 — 取引候補からの自動分類（#24）・未払金の残高反映（#69）など —
 * は購読側にあるため、張り忘れるとバッチ経路でだけ後続が動かない。
 */
import {
  compositionEnvFromEnvironment,
  createDeps,
  type AppDeps,
  type CompositionEnv,
} from '../composition-root.js'
import { registerEventHandlers } from '../event-handlers/index.js'

/** バッチが使う依存を合成する（API と同じ合成 + 同じイベント購読） */
export async function createBatchDeps(env: CompositionEnv): Promise<AppDeps> {
  const deps = await createDeps(env)
  registerEventHandlers(deps)
  return deps
}

let cached: Promise<AppDeps> | undefined

/**
 * 環境変数から合成した依存を返す（プロセス内で 1 度だけ組み立てる）。
 *
 * Lambda は同じ実行環境を次の起動でも使い回すため、DB クライアントや Parameter Store の
 * クライアントを毎回作り直すと接続の作り直しぶんだけ遅くなる。合成に失敗した場合は
 * キャッシュを捨て、次の起動でやり直せるようにする（設定の入れ替え後も再起動を待たずに回復する）。
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
