// FinMind's public API (api.finmindtrade.com): Taiwan financial statements,
// valuation history, dividends and prices. Anonymous use needs no token
// and allows browser requests, within an hourly quota, so responses are
// cached for a day.

import { CACHE_MAX_AGE_MS, purgeCaches } from '../storage/cacheCleanup'

const API = 'https://api.finmindtrade.com/api/v4/data'
export const CACHE_PREFIX = 'pfm:finmind:'
const CACHE_MS = CACHE_MAX_AGE_MS

export type FinMindDataset =
  | 'TaiwanStockInfo'
  | 'TaiwanStockFinancialStatements'
  | 'TaiwanStockBalanceSheet'
  | 'TaiwanStockCashFlowsStatement'
  | 'TaiwanStockDividend'
  | 'TaiwanStockPER'
  | 'TaiwanStockPrice'
  | 'USStockPrice'
  | 'TaiwanExchangeRate'
  | 'TaiwanStockInstitutionalInvestorsBuySell'
  | 'TaiwanStockMarginPurchaseShortSale'
  | 'TaiwanStockShareholding'
  | 'TaiwanStockTotalReturnIndex'
  | 'TaiwanStockTotalInstitutionalInvestors'
  | 'TaiwanStockTotalMarginPurchaseShortSale'
  | 'TaiwanFuturesDaily'

export class FinMindError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinMindError'
  }
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export function readCache<T>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { at, data } = JSON.parse(raw) as { at: number; data: T[] }
    return Date.now() - at < CACHE_MS ? data : null
  } catch {
    return null
  }
}

let lastPurge = 0

export function writeCache<T>(key: string, data: T[]): void {
  const now = Date.now()
  // Dated keys (start dates move every day) would otherwise pile up.
  if (now - lastPurge > 60_000) {
    purgeCaches('expired', now)
    lastPurge = now
  }
  try {
    // `at` first: cacheCleanup reads it without parsing the data.
    localStorage.setItem(key, JSON.stringify({ at: now, data }))
  } catch {
    // Storage full or blocked: the data still works this time.
  }
}

export async function fetchDataset<T>(
  dataset: FinMindDataset,
  id: string,
  startDate?: string,
  fetcher: Fetcher = (url) => fetch(url),
): Promise<T[]> {
  const key = `${CACHE_PREFIX}${dataset}:${id}:${startDate ?? ''}`
  const cached = readCache<T>(key)
  if (cached) return cached
  const data = await requestDataset<T>(dataset, id, startDate, fetcher)
  writeCache(key, data)
  return data
}

// Once the free quota is used up, every request fails (in the browser as
// a CORS error, since the 402 reply has no CORS header). Pause all requests
// for a while instead of sending one failing call per caller.
export const QUOTA_BACKOFF_MS = 10 * 60 * 1000
let blockedUntil = 0
export const resetFinMindBackoff = () => {
  blockedUntil = 0
}

// One uncached request; for large datasets whose callers cache a
// condensed form themselves.
export async function requestDataset<T>(
  dataset: FinMindDataset,
  id: string,
  startDate?: string,
  fetcher: Fetcher = (url) => fetch(url),
): Promise<T[]> {
  if (Date.now() < blockedUntil) throw new FinMindError('FinMind 免費額度暫時用完，請一小時後再試。')
  const params = new URLSearchParams({ dataset, data_id: id, ...(startDate ? { start_date: startDate } : {}) })
  let response: Awaited<ReturnType<Fetcher>>
  try {
    response = await fetcher(`${API}?${params}`)
  } catch (e) {
    blockedUntil = Date.now() + QUOTA_BACKOFF_MS
    throw e
  }
  if (response.status === 402 || response.status === 429) {
    blockedUntil = Date.now() + QUOTA_BACKOFF_MS
    throw new FinMindError('FinMind 免費額度暫時用完，請一小時後再試。')
  }
  if (!response.ok) throw new FinMindError(`FinMind 讀取失敗（${response.status}）`)
  const json = (await response.json()) as { msg?: string; status?: number; data?: T[] }
  if (json.status && json.status !== 200) {
    if (json.status === 402) blockedUntil = Date.now() + QUOTA_BACKOFF_MS
    throw new FinMindError(json.status === 402 ? 'FinMind 免費額度暫時用完，請一小時後再試。' : `FinMind：${json.msg ?? '讀取失敗'}`)
  }
  return json.data ?? []
}
