import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createDeps } from './composition-root.js'
import { createApp } from './app.js'

const deps = createDeps({ DATABASE_URL: process.env['DATABASE_URL'] })
const app = createApp(deps)
const port = Number(process.env['PORT'] ?? 3001)

serve({ fetch: app.fetch, port }, info => {
  console.log(`API server running on http://localhost:${info.port}`)
})
