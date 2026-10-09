import { z } from 'zod'
import type { Holding } from '../storage/schema'
import { runWebResearch, type ResearchClient, type ResearchResult } from './webResearch'
import { extractStructured, type ExtractionClient } from './extractStructured'

export const FundNavResultSchema = z.object({
  results: z.array(
    z.object({
      ticker: z.string().describe('與輸入清單相同的基金代碼'),
      nav: z.number().nullable().describe('最新單位淨值；找不到填 null'),
      navDate: z.string().describe('淨值日期 YYYY-MM-DD；找不到填空字串'),
      currency: z.enum(['TWD', 'USD', 'OTHER']).describe('淨值的計價幣別'),
      note: z.string().describe('資料來源網站或無法取得的原因，一句話'),
    }),
  ),
})
export type FundNavResult = z.infer<typeof FundNavResultSchema>['results'][number]

type FundRef = Pick<Holding, 'ticker' | 'name' | 'provider' | 'currency'>

export function buildFundNavPrompt(funds: FundRef[], today: string): string {
  const list = funds
    .map(
      (f, i) =>
        `${i + 1}. 代碼 ${f.ticker}；名稱 ${f.name || '（未填）'}；基金公司／平台 ${f.provider || '（未填）'}；計價幣別 ${f.currency === 'USD' ? '美元' : '新台幣'}`,
    )
    .join('\n')
  return `今天是 ${today}。請上網查詢下列共同基金「最新公布的單位淨值」與淨值日期。
優先使用基金公司官網、投信投顧公會、基金銷售平台（例如基富通、鉅亨網）等可靠來源；同一檔基金若有多個級別，以符合計價幣別、名稱最接近者為準，並註明級別。

${list}

請用表格列出每檔基金：代碼、名稱、級別、最新淨值、淨值日期、計價幣別、資料來源。找不到的基金請直接寫「未取得」，不要猜測。`
}

export const FUND_NAV_EXTRACTION_INSTRUCTIONS =
  '把報告中每檔基金的最新淨值轉成結構化資料。ticker 必須使用輸入清單中的基金代碼；報告寫「未取得」的基金 nav 填 null。'

export interface NavUpdateRow {
  holding: Holding
  nav: number | null
  navDate: string
  note: string
  // Only rows with a NAV in the holding's own currency can be applied.
  applicable: boolean
  reason: string | null
}

// Pairs each fund holding with its looked-up NAV, matched by fund code.
export function matchNavResults(funds: Holding[], results: FundNavResult[]): NavUpdateRow[] {
  const byTicker = new Map(results.map((r) => [r.ticker.trim().toUpperCase(), r]))
  return funds.map((holding) => {
    const r = byTicker.get(holding.ticker.trim().toUpperCase())
    if (!r || r.nav === null || r.nav <= 0) {
      return { holding, nav: null, navDate: '', note: r?.note ?? '報告中沒有這檔基金', applicable: false, reason: '未取得淨值' }
    }
    const sameCurrency = r.currency === holding.currency
    return {
      holding,
      nav: r.nav,
      navDate: r.navDate,
      note: r.note,
      applicable: sameCurrency,
      reason: sameCurrency ? null : '計價幣別與持股不同，請確認級別',
    }
  })
}

export async function lookupFundNavs(
  funds: Holding[],
  today: string,
  clients?: { research?: ResearchClient; extraction?: ExtractionClient },
): Promise<{ research: ResearchResult; rows: NavUpdateRow[]; estimatedCostUsd: number }> {
  const research = await runWebResearch(
    // About two searches per fund, within a sensible ceiling.
    { prompt: buildFundNavPrompt(funds, today), maxSearches: Math.min(2 * funds.length + 2, 20) },
    clients?.research,
  )
  const extraction = await extractStructured(
    FundNavResultSchema,
    FUND_NAV_EXTRACTION_INSTRUCTIONS,
    research.markdown,
    clients?.extraction,
  )
  return {
    research,
    rows: matchNavResults(funds, extraction.data.results),
    estimatedCostUsd: research.estimatedCostUsd + extraction.estimatedCostUsd,
  }
}
