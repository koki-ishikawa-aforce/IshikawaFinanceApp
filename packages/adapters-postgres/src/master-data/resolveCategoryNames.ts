/**
 * ResolveCategoryNames の実 DB 実装
 *
 * 第 1 波では関数注入のスタブだった queryDeps を category_masters の
 * 実テーブル読みに差し替える（queryDeps.ts の予告どおり。Query 実装側は無変更）。
 */
import { inArray } from 'drizzle-orm'
import type { Db } from '../client'
import { categoryMasters } from '../schema'
import type { ResolveCategoryNames } from '../queryDeps'

export function createDbResolveCategoryNames(db: Db): ResolveCategoryNames {
  return async ids => {
    if (ids.length === 0) return new Map()
    const rows = await db
      .select({ categoryId: categoryMasters.categoryId, name: categoryMasters.name })
      .from(categoryMasters)
      .where(inArray(categoryMasters.categoryId, ids))
    // 未知の ID は Map に含めない（queryDeps.ts の契約どおり）
    return new Map(rows.map(row => [row.categoryId, row.name]))
  }
}
