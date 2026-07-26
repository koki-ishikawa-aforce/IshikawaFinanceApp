/**
 * 統合テスト共通セットアップ（vitest setupFiles）
 *
 * 接続の生成・beforeEach の全テーブルリセット・afterAll のクローズを
 * ここで一元的に登録する。各テストファイルは `import { db } from './setup'`
 * するだけでよく、リセットの書き忘れによる順序依存テストを構造的に防ぐ。
 * （fileParallelism: false 前提 — 共有 DB を直列に使う）
 */
import 'dotenv/config'
import { afterAll, beforeEach } from 'vitest'
import { createTestDb, resetDb } from '../helpers/db'

const testDb = createTestDb()

/** テストファイル内で共有する DB 接続 */
export const db = testDb.db

beforeEach(() => resetDb(db))
afterAll(() => testDb.close())
