import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

// generate は URL 不要、migrate（実 Neon / ローカル PostgreSQL への適用）は
// .env または環境変数の DATABASE_URL を使う
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
