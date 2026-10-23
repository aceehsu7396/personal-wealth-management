// FinMind's public API (api.finmindtrade.com): Taiwan financial statements,
// valuation history, dividends and prices. Anonymous use needs no token
// and allows browser requests, within an hourly quota, so responses are
// cached for a day.

const API = 'https://api.finmindtrade.com/api/v4/data'
const CACHE_PREFIX = 'pfm:finmind:'
const CACHE_MS = 24 * 3600 * 1000

export type FinMindDataset =
  | 'TaiwanStockInfo'
  | 'TaiwanStockFinancialStatements'
  | 'TaiwanStockBalanceSheet'
  | 'TaiwanStockCashFlowsStatement'
  | 'TaiwanStockDividend'
  | 'TaiwanStockPER'
  | 'TaiwanStockPrice'

export class FinMindError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinMindError'
  }
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

function readCache<T>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { at, data } = JSON.parse(raw) as { at: number; data: T[] }
    return Date.now() - at < CACHE_MS ? data : null
  } catch {
    return null
  }
}

function writeCache<T>(key: string, data: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
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
  const params = new URLSearchParams({ dataset, data_id: id, ...(startDate ? { start_date: startDate } : {}) })
  const key = `${CACHE_PREFIX}${dataset}:${id}:${startDate ?? ''}`
  const cached = readCache<T>(key)
  if (cached) return cached
  const response = await fetcher(`${API}?${params}`)
  if (response.status === 402 || response.status === 429) {
    throw new FinMindError('FinMind 免費額度暫時用完，請一小時後再試。')
  }
  if (!response.ok) throw new FinMindError(`FinMind 讀取失敗（${response.status}）`)
  const json = (await response.json()) as { msg?: string; status?: number; data?: T[] }
  if (json.status && json.status !== 200) {
    throw new FinMindError(json.status === 402 ? 'FinMind 免費額度暫時用完，請一小時後再試。' : `FinMind：${json.msg ?? '讀取失敗'}`)
  }
  const data = json.data ?? []
  writeCache(key, data)
  return data
}
