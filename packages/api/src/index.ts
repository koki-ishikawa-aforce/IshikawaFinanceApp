import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createDeps } from './composition-root.js'
import { createApp } from './app.js'

const deps = createDeps({
  DATABASE_URL: process.env['DATABASE_URL'],
  GOOGLE_OAUTH_CLIENT_ID: process.env['GOOGLE_OAUTH_CLIENT_ID'],
  GOOGLE_OAUTH_CLIENT_SECRET: process.env['GOOGLE_OAUTH_CLIENT_SECRET'],
  GOOGLE_OAUTH_REDIRECT_URI: process.env['GOOGLE_OAUTH_REDIRECT_URI'],
  GMAIL_OAUTH_STATE_SECRET: process.env['GMAIL_OAUTH_STATE_SECRET'],
  AWS_REGION: process.env['AWS_REGION'],
  FAILSAFE_EMAIL_FROM: process.env['FAILSAFE_EMAIL_FROM'],
  FAILSAFE_EMAIL_TO: process.env['FAILSAFE_EMAIL_TO'],
  FAILSAFE_FAILURE_THRESHOLD: process.env['FAILSAFE_FAILURE_THRESHOLD'],
})
const app = createApp(deps)
const port = Number(process.env['PORT'] ?? 3001)

serve({ fetch: app.fetch, port }, info => {
  console.log(`API server running on http://localhost:${info.port}`)
})
