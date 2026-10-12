import {
  fetchTwseSeries,
  loadSeries,
  seriesForBacktest,
  type Bar,
  type FetchProgress,
} from '../market/priceHistory'
import { parseSymbol } from './templates'

// Indicators need history before the test starts (200-day averages,
// 12-month momentum): fetch 15 months earlier than the start date.
export const WARMUP_MONTHS = 15

export function warmupStart(start: string): string {
  const [y, m] = start.split('-').map(Number)
  const total = y * 12 + (m - 1) - WARMUP_MONTHS
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

export class MissingPriceDataError extends Error {
  symbols: string[]
  constructor(symbols: string[]) {
    super(`缺少價格資料：${symbols.join('、')}。美股與上櫃股票請先匯入 Yahoo Finance 的 CSV。`)
    this.name = 'MissingPriceDataError'
    this.symbols = symbols
  }
}

// Adjusted bars for each symbol: Taiwan-listed codes are downloaded from
// TWSE (cached), others must have been imported from CSV.
export async function loadPriceData(
  symbols: string[],
  start: string,
  end: string,
  onProgress?: (p: FetchProgress) => void,
): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {}
  const missing: string[] = []
  for (const symbol of symbols) {
    const cached = loadSeries(symbol)
    const { market, code } = parseSymbol(symbol)
    if (cached?.source === 'csv') {
      out[symbol] = seriesForBacktest(cached).bars
    } else if (market === 'TW') {
      const series = await fetchTwseSeries(code, warmupStart(start), end, onProgress)
      out[symbol] = seriesForBacktest(series).bars
    } else {
      missing.push(symbol)
    }
  }
  if (missing.length > 0) throw new MissingPriceDataError(missing)
  return out
}
