import type { Holding } from '../storage/schema'
import { fetchDataset, type Fetcher } from '../research/finmind'
import { TWSE_TICKER } from './priceSync'
import { findFund, fundCurrency, type FundNav } from './fundNav'

// Free sources for the latest price of every holding (no API key):
// listed TW stocks/ETFs from TWSE, OTC stocks and US stocks from FinMind,
// funds from the daily Anue NAV snapshot, and USD/TWD from FinMind.

export type PriceSource = 'twse' | 'finmind_tw' | 'finmind_us' | 'fund' | 'manual'

export const SOURCE_LABELS: Record<PriceSource, string> = {
  twse: '上市台股',
  finmind_tw: '上櫃台股',
  finmind_us: '美股',
  fund: '基金',
  manual: '手動',
}

const US_TICKER = /^[A-Z][A-Z.-]{0,5}$/

// Where a holding's price comes from. Cash and unknown codes stay manual.
export function priceSourceOf(h: Pick<Holding, 'kind' | 'ticker' | 'currency'>): PriceSource {
  const ticker = h.ticker.trim().toUpperCase()
  if (h.kind === 'fund') return 'fund'
  if (h.currency === 'USD') return US_TICKER.test(ticker) ? 'finmind_us' : 'manual'
  return TWSE_TICKER.test(ticker) ? 'twse' : 'manual'
}

export interface Quote {
  price: number
  date: string
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

const LOOKBACK_DAYS = 14

// The latest daily close from FinMind (TWSE and TPEx, or US).
export async function fetchFinMindClose(ticker: string, market: 'TW' | 'US', today: string, fetcher?: Fetcher): Promise<Quote | null> {
  const start = shiftDays(today, LOOKBACK_DAYS)
  if (market === 'TW') {
    const rows = await fetchDataset<{ date: string; close: number }>('TaiwanStockPrice', ticker, start, fetcher)
    const last = rows.filter((r) => r.close > 0).at(-1)
    return last ? { price: last.close, date: last.date } : null
  }
  const rows = await fetchDataset<{ date: string; Close: number }>('USStockPrice', ticker, start, fetcher)
  const last = rows.filter((r) => r.Close > 0).at(-1)
  return last ? { price: last.Close, date: last.date } : null
}

// USD/TWD: the mid of the latest spot buy and sell rates.
export async function fetchUsdTwd(today: string, fetcher?: Fetcher): Promise<Quote | null> {
  const rows = await fetchDataset<{ date: string; spot_buy: number; spot_sell: number }>('TaiwanExchangeRate', 'USD', shiftDays(today, LOOKBACK_DAYS), fetcher)
  const last = rows.filter((r) => r.spot_buy > 0 && r.spot_sell > 0).at(-1)
  return last ? { price: Math.round(((last.spot_buy + last.spot_sell) / 2) * 1000) / 1000, date: last.date } : null
}

export type FundQuote = Quote | { skip: string }

// A fund's NAV from the snapshot, when its currency matches the holding.
export function fundQuote(h: Pick<Holding, 'ticker' | 'name' | 'currency'>, funds: FundNav[]): FundQuote {
  const fund = findFund(h, funds)
  if (!fund) return { skip: '找不到基金代碼或名稱（可在編輯時搜尋基金）' }
  if (fundCurrency(fund.currency) !== h.currency) return { skip: `基金以${fund.currency}計價，請手動輸入台幣或美元淨值` }
  return { price: fund.nav, date: fund.date }
}
