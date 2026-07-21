import type { DashboardQuery } from '@warimaru/domain'
import {
  createNeonHttpDb,
  NeonDashboardQuery,
  createDbResolveCategoryNames,
  createDbResolveViewerRole,
} from '@warimaru/adapters-neon'
import { createMockDashboardQuery } from './mock-dashboard-query.js'

export interface AppDeps {
  dashboardQuery: DashboardQuery
}

export function createDeps(env: { DATABASE_URL?: string | undefined }): AppDeps {
  if (!env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — using mock data')
    return { dashboardQuery: createMockDashboardQuery() }
  }

  const db = createNeonHttpDb(env.DATABASE_URL)
  const resolveCategoryNames = createDbResolveCategoryNames(db)
  const resolveViewerRole = createDbResolveViewerRole(db)
  const dashboardQuery = new NeonDashboardQuery(db, { resolveCategoryNames, resolveViewerRole })

  return { dashboardQuery }
}
