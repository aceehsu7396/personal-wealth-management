// public/data/stocks.json, built daily by GitHub Actions
// (scripts/stocks-data.mts) from the TWSE open data: every listed stock and
// ETF with valuation, monthly revenue growth and price momentum.

export interface StockRow {
  code: string
  name: string
  // Company industry from the monthly revenue report; ETFs are 'ETF'.
  industry: string
  isEtf: boolean
  close: number | null
  pe: number | null
  dividendYield: number | null
  pb: number | null
  // 億元
  marketCap: number | null
  // Turnover on the latest trading day, 億元.
  tradeValue: number | null
  // Monthly revenue growth vs the same month last year, and year to date (%).
  revenueYoy: number | null
  revenueYtdYoy: number | null
  revenueMonth: string | null
  // Price change over 1/3/6/12 months (fractions, dividends not added back).
  ret1m: number | null
  ret3m: number | null
  ret6m: number | null
  ret12m: number | null
}

export interface StockData {
  generatedAt: string
  // Latest trading day of the prices.
  date: string
  errors: string[]
  stocks: StockRow[]
}

export const STOCK_DATA_PATH = 'data/stocks.json'

export async function fetchStockData(base: string = import.meta.env.BASE_URL): Promise<StockData | null> {
  try {
    const response = await fetch(`${base}${STOCK_DATA_PATH}`, { cache: 'no-cache' })
    if (!response.ok) return null
    return (await response.json()) as StockData
  } catch {
    return null
  }
}

// A price change between two unadjusted closes; null when the ratio looks
// like a split or reverse split rather than a market move.
export function priceReturn(now: number | null | undefined, then: number | null | undefined): number | null {
  if (!now || !then || now <= 0 || then <= 0) return null
  const ratio = now / then
  if (ratio < 0.45 || ratio > 2.2) return null
  return ratio - 1
}

export function isEtfCode(code: string): boolean {
  return code.startsWith('00')
}
