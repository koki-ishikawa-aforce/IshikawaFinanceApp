/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）での世帯の状態（シナリオ）解決。
 *
 * fixture の既定は「運用開始済み・口座も登録済み」の世帯なので、口座の登録が
 * まだ済んでいない人にだけ出る画面（設定 > 口座タブの口座を追加するボタン）が描画されず、
 * 見た目を壊しても視覚回帰テストが緑のまま通る。URL クエリ `?mockScenario=...` で
 * その状態を再現できるようにする。
 *
 * ロール（{@link ./role}）と同じく、指定はタブ単位で保持する（理由は {@link ./query-state}）。
 */
import { resolveMockQueryState } from './query-state'

/**
 * - `default`: 別銀行貯蓄口座・NISA 口座まで登録済みの世帯（既定）
 * - `accounts-unregistered`: 三井住友系の口座はあり、任意登録の口座
 *   （別銀行貯蓄・NISA）が未登録の世帯
 * - `accounts-none`: 口座を 1 件も登録していない世帯（#395 以降の新規利用者の初期状態。
 *   三井住友系も利用者が登録するようになったため、この状態が本番の出発点になる）
 */
export type MockScenario = 'default' | 'accounts-unregistered' | 'accounts-none'

const STORAGE_KEY = 'warimaru.mockScenario'

function isMockScenario(value: string | null): value is MockScenario {
  return value === 'default' || value === 'accounts-unregistered' || value === 'accounts-none'
}

export function getMockScenario(): MockScenario {
  return resolveMockQueryState({
    param: 'mockScenario',
    storageKey: STORAGE_KEY,
    isValid: isMockScenario,
    fallback: 'default',
  })
}
