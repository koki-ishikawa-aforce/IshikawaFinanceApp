/**
 * Query 実装が必要とするコンテキスト外 Read データの注入ポート
 *
 * カテゴリ名（マスタ管理: category_masters）と viewer role（オンボーディング・
 * 認証: app_users）は第 2 波のテーブルのため、第 1 波では関数として注入する。
 * 第 2 波で実テーブルを読む実装に差し替える（Query 実装側は無変更）。
 */
import type { CategoryId, UserId, UserRole } from '@warimaru/domain'

/** カテゴリ ID → 表示名の解決（未知の ID は Map に含めない） */
export type ResolveCategoryNames = (ids: CategoryId[]) => Promise<Map<string, string>>

/** viewer の役割（honey / darling）の解決 */
export type ResolveViewerRole = (viewerId: UserId) => Promise<UserRole>
