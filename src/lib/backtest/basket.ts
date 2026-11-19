import type { StockRow } from '../screener/stockData'
import { monthsInRange, TWSE_REQUEST_GAP_MS } from '../market/priceHistory'
import { warmupStart } from './data'

// Too few trades on one stock (handbook 10 §6.7): widen the sample with
// similar stocks, or lengthen it, rather than shortening the rules.

export const BROAD_ETFS = ['0050', '006208', '0056', '00878', '00692']
export const PEER_COUNT = 5
export const BASKET_MAX = 8

const tw = (code: string) => `TW:${code}`

// The stock with the largest peers in its industry; an ETF with the broad
// Taiwan ETFs. Null when the stock is not in the daily data.
export function peerBasket(symbol: string, stocks: StockRow[]): { label: string; symbols: string[] } | null {
  const code = symbol.replace(/^TW:/, '')
  const row = stocks.find((s) => s.code === code)
  if (!row) return null
  if (row.isEtf) return { label: '常用台股 ETF', symbols: [symbol, ...BROAD_ETFS.filter((c) => c !== code).map(tw)] }
  const peers = stocks
    .filter((s) => !s.isEtf && s.industry === row.industry && s.code !== code && s.marketCap !== null)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, PEER_COUNT)
  if (peers.length === 0) return null
  return { label: `${row.industry}前 ${peers.length} 大`, symbols: [symbol, ...peers.map((s) => tw(s.code))] }
}

// The current symbols plus the watched Taiwan stocks, up to BASKET_MAX.
export function watchBasket(symbols: string[], watched: string[]): string[] | null {
  const extra = watched.filter((s) => s.startsWith('TW:') && !symbols.includes(s))
  if (extra.length === 0) return null
  return [...symbols, ...extra].slice(0, Math.max(BASKET_MAX, symbols.length))
}

// Seconds to download what the cache lacks: one request a month and one a
// year (ex-rights), two seconds apart.
export function downloadSeconds(symbols: string[], start: string, end: string, cachedMonths: (symbol: string) => string[]): number {
  const months = monthsInRange(warmupStart(start), end)
  const current = end.slice(0, 7)
  let requests = 0
  for (const s of symbols.filter((x) => x.startsWith('TW:'))) {
    const have = new Set(cachedMonths(s).filter((m) => m !== current))
    const missing = months.filter((m) => !have.has(m))
    requests += missing.length + new Set(missing.map((m) => m.slice(0, 4))).size
  }
  return (requests * TWSE_REQUEST_GAP_MS) / 1000
}

export function downloadText(seconds: number): string {
  if (seconds < 30) return '使用已下載的資料'
  return `首次下載約 ${Math.ceil(seconds / 60)} 分鐘，之後使用快取`
}
