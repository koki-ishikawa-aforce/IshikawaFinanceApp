/**
 * Query 実装が必要とするコンテキスト外 Read データの注入ポート
 *
 * カテゴリ名（マスタ管理: category_masters）と viewer role（オンボーディング・
 * 認証: app_users）は第 2 波のテーブルのため、第 1 波では関数として注入する。
 * 第 2 波で実テーブルを読む実装に差し替える（Query 実装側は無変更）。
 */
import type { CategoryId, ParameterStorePath, UserId, UserRole } from '@warimaru/domain'

/** カテゴリ ID → 表示名の解決（未知の ID は Map に含めない） */
export type ResolveCategoryNames = (ids: CategoryId[]) => Promise<Map<string, string>>

/** viewer の役割（honey / darling）の解決 */
export type ResolveViewerRole = (viewerId: UserId) => Promise<UserRole>

/**
 * Parameter Store パス → 実値の解決（AllowlistQuery / SpouseCompletionQuery 用）
 *
 * phase0_configs の payload はパス参照のみ保持する（OQ-27）ため、
 * 実 LINE userID 等の解決は DB 外。実 SSM 実装は application 層の責務で、
 * adapters-neon は AWS SDK に依存しない。
 */
export type ResolveParameterStoreValue = (path: ParameterStorePath) => Promise<string>
