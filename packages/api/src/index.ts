import 'dotenv/config'
import { serve } from '@hono/node-server'
import { compositionEnvFromEnvironment, createDeps } from './composition-root.js'
import { createApp } from './app.js'

// DB ドライバの選択で pg を遅延読み込みするため合成は非同期（#349）
const deps = await createDeps(compositionEnvFromEnvironment())
const app = createApp(deps)
const port = Number(process.env['PORT'] ?? 3001)

serve({ fetch: app.fetch, port }, info => {
  console.log(`API server running on http://localhost:${info.port}`)
})
