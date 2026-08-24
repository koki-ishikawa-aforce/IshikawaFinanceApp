import { Hono } from 'hono'
import { z } from 'zod'
import { AccountIdSchema, NotFoundError, YearMonthSchema } from '@warimaru/domain'
import type {
  AccountBalanceQuery,
  AccountDetailQuery,
  BalanceTimeSeriesQuery,
} from '@warimaru/domain'
import type { AppEnv } from '../env.js'

const TotalParamsSchema = z.object({
  asOf: z.coerce.date().optional(),
})

/**
 * 推移グラフの期間。読み出し元が残高変動履歴（1 変動 = 1 行）に変わり、返す行数が
 * 履歴の蓄積量に比例するようになったため上限を課す（#398）。'YYYY-MM' はゼロ埋めで
 * 辞書順比較が時系列順と一致する。
 */
const MAX_TIME_SERIES_MONTHS = 120

/**
 * 口座詳細の期間。推移グラフ（世帯合算）と違い、口座詳細は変動 1 件 = 応答 1 行の履歴も
 * 返すため、返す量が期間の長さに直に比例する。画面が求める最長（1 年）に余裕を持たせた
 * ところで頭打ちにし、10 年ぶんの明細を 1 回の応答で運ばせない
 */
const MAX_ACCOUNT_DETAIL_MONTHS = 24

/** 'YYYY-MM' の期間（from <= to、指定の月数以内）を受け取るパラメータ */
function monthRangeSchema(maxMonths: number) {
  return z
    .object({
      from: YearMonthSchema,
      to: YearMonthSchema,
    })
    .superRefine((params, ctx) => {
      if (params.from > params.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'from は to 以前である必要があります',
          path: ['from'],
        })
        return
      }
      const monthsOf = (ym: string): number => {
        const [year, month] = ym.split('-').map(Number) as [number, number]
        return year * 12 + month
      }
      if (monthsOf(params.to) - monthsOf(params.from) + 1 > maxMonths) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `期間は最大 ${maxMonths} か月です`,
          path: ['to'],
        })
      }
    })
}

const TimeSeriesParamsSchema = monthRangeSchema(MAX_TIME_SERIES_MONTHS)

const AccountDetailParamsSchema = monthRangeSchema(MAX_ACCOUNT_DETAIL_MONTHS)

export function balancesRoutes(
  accountBalanceQuery: AccountBalanceQuery,
  balanceTimeSeriesQuery: BalanceTimeSeriesQuery,
  accountDetailQuery: AccountDetailQuery,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const result = await accountBalanceQuery.fetchBalanceList(c.get('viewerId'))
    return c.json(result)
  })

  app.get('/total', async c => {
    const params = TotalParamsSchema.parse({ asOf: c.req.query('asOf') })
    const result = await accountBalanceQuery.fetchAssetTotal(params.asOf ?? new Date())
    return c.json(result)
  })

  app.get('/time-series', async c => {
    const params = TimeSeriesParamsSchema.parse({
      from: c.req.query('from'),
      to: c.req.query('to'),
    })
    const result = await balanceTimeSeriesQuery.fetch(c.get('viewerId'), params.from, params.to)
    return c.json(result)
  })

  /**
   * 口座 1 件の詳細（#406。残高 hero・単線グラフ・取引履歴）。
   *
   * 所有者以外には 404 を返す（Query が null を返す）。書き込み側の口座エンドポイントが
   * 403 を返すのと揃えないのは、こちらが読み取りで、403 と 404 の違いから
   * 配偶者の口座の有無を数えられるようにしないため。
   */
  app.get('/accounts/:accountId', async c => {
    const accountId = AccountIdSchema.parse(c.req.param('accountId'))
    const params = AccountDetailParamsSchema.parse({
      from: c.req.query('from'),
      to: c.req.query('to'),
    })
    const result = await accountDetailQuery.fetch(
      c.get('viewerId'),
      accountId,
      params.from,
      params.to,
    )
    if (result === null) throw new NotFoundError('Account', accountId)
    return c.json(result)
  })

  return app
}
