import type { LynchCategory } from '../storage/schema'
import { fetchDataset, type Fetcher } from './finmind'
import {
  analyzeStatements,
  fairValues,
  suggestLynch,
  valuationStats,
  type DividendRow,
  type FairValues,
  type FinRow,
  type PerRow,
  type StockHealth,
  type ValuationAssumptions,
  type ValuationStats,
} from './fundamentals'
import { analyzeEtf, type EtfProfile, type PriceRow } from './etfProfile'

// The research card's automatic data: one fetch from FinMind, computed
// into a small snapshot stored on the card (no AI, no key).

export interface AutoResearch {
  fetchedAt: string
  kind: 'stock' | 'etf'
  name: string
  industry: string
  price: number | null
  priceDate: string | null
  stock: (StockHealth & { valuation: ValuationStats; lynch: LynchCategory }) | null
  etf: EtfProfile | null
}

// Refresh the snapshot when it is older than this.
export const AUTO_REFRESH_DAYS = 7

export function isStale(auto: AutoResearch | undefined, today: string): boolean {
  if (!auto) return true
  return (Date.parse(today) - Date.parse(auto.fetchedAt.slice(0, 10))) / 86_400_000 >= AUTO_REFRESH_DAYS
}

function shiftYears(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) - years}${date.slice(4)}`
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export class NotFoundError extends Error {
  constructor(code: string) {
    super(`FinMind 查無 ${code}，請確認代號（只支援台股上市、上櫃與 ETF）。`)
    this.name = 'NotFoundError'
  }
}

export async function buildAutoResearch(code: string, today: string, fetcher?: Fetcher): Promise<AutoResearch> {
  const get = <T,>(dataset: Parameters<typeof fetchDataset>[0], id: string, start?: string) => fetchDataset<T>(dataset, id, start, fetcher)
  const info = await get<{ industry_category: string; stock_name: string }>('TaiwanStockInfo', code)
  if (info.length === 0) throw new NotFoundError(code)
  const industry = info.find((i) => i.industry_category !== '電子工業')?.industry_category ?? info[0].industry_category
  const name = info[0].stock_name
  const isEtf = industry === 'ETF' || code.startsWith('00')
  // A few extra days so a full five-year window is always covered.
  const fiveYears = shiftDays(shiftYears(today, 5), 20)

  if (isEtf) {
    const prices = await get<PriceRow>('TaiwanStockPrice', code, fiveYears)
    const dividends = await get<DividendRow>('TaiwanStockDividend', code, '2008-01-01')
    const benchmark =
      code === '0050'
        ? undefined
        : { prices: await get<PriceRow>('TaiwanStockPrice', '0050', fiveYears), dividends: await get<DividendRow>('TaiwanStockDividend', '0050', '2008-01-01') }
    const last = [...prices].sort((a, b) => a.date.localeCompare(b.date)).pop()
    return {
      fetchedAt: new Date().toISOString(),
      kind: 'etf',
      name,
      industry: 'ETF',
      price: last?.close ?? null,
      priceDate: last?.date ?? null,
      stock: null,
      etf: analyzeEtf({ prices, dividends, benchmark, today }),
    }
  }

  const income = await get<FinRow>('TaiwanStockFinancialStatements', code, fiveYears)
  const balance = await get<FinRow>('TaiwanStockBalanceSheet', code, fiveYears)
  const cashflow = await get<FinRow>('TaiwanStockCashFlowsStatement', code, fiveYears)
  const dividends = await get<DividendRow>('TaiwanStockDividend', code, '2008-01-01')
  const per = await get<PerRow>('TaiwanStockPER', code, fiveYears)
  const recent = await get<PriceRow>('TaiwanStockPrice', code, shiftDays(today, 14))
  const last = [...recent].sort((a, b) => a.date.localeCompare(b.date)).pop()
  const health = analyzeStatements({ income, balance, cashflow, dividends, industry, today })
  const valuation = valuationStats(per)
  return {
    fetchedAt: new Date().toISOString(),
    kind: 'stock',
    name,
    industry,
    price: last?.close ?? null,
    priceDate: last?.date ?? null,
    stock: health ? { ...health, valuation, lynch: suggestLynch(health, industry, valuation.pb?.current ?? null) } : null,
    etf: null,
  }
}

export function autoFairValues(auto: AutoResearch, assumptions?: ValuationAssumptions, price?: number): FairValues | null {
  const s = auto.stock
  if (!s) return null
  return fairValues(
    { epsTtm: s.epsTtm, epsCagr3y: s.epsCagr3y, isFinancial: s.isFinancial, price: price ?? auto.price, valuation: s.valuation },
    assumptions,
  )
}

// Fields the card's scoring reads, derived from the snapshot so the user
// never types them: F-score, growth, red flags, fair values and price.
export function derivedFields(
  auto: AutoResearch,
  assumptions: ValuationAssumptions | undefined,
  explainedFlags: Record<string, string>,
): {
  fScore?: number
  historicalGrowthPercent?: number
  hasUnexplainedRedFlags: boolean
  fairValueBear: number
  fairValueBase: number
  fairValueBull: number
  currentPrice: number
} {
  const s = auto.stock
  const fv = autoFairValues(auto, assumptions)
  return {
    fScore: s?.fScore?.score,
    historicalGrowthPercent: s?.epsCagr3y === null || s?.epsCagr3y === undefined ? undefined : Math.round(s.epsCagr3y * 10) / 10,
    hasUnexplainedRedFlags: (s?.redFlags ?? []).some((f) => !explainedFlags[f.key]?.trim()),
    fairValueBear: fv?.bear ?? 0,
    fairValueBase: fv?.base ?? 0,
    fairValueBull: fv?.bull ?? 0,
    currentPrice: auto.price ?? 0,
  }
}

// A card's refreshed automatic fields (snapshot plus derived numbers).
export async function refreshedFields(
  thesis: { ticker: string; assumptions?: ValuationAssumptions; explainedFlags: Record<string, string> },
  today: string,
  fetcher?: Fetcher,
) {
  const auto = await buildAutoResearch(thesis.ticker, today, fetcher)
  return { auto, kind: auto.kind, ...derivedFields(auto, thesis.assumptions, thesis.explainedFlags) }
}
