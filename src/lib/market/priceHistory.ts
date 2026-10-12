import { parseNumber } from './twse'

// Daily bar. Prices in a cached series are raw; adjustments are applied
// when a backtest reads them (see adjustBars).
export interface Bar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Ex-dividend/ex-rights events: price factor = reference price ÷ prior close.
export interface PriceEvent {
  date: string
  factor: number
}

export interface PriceSeries {
  symbol: string
  source: 'twse' | 'csv'
  bars: Bar[]
  // Calendar months already fetched from TWSE (the current month is always
  // re-fetched because it is still incomplete).
  months: string[]
  events: PriceEvent[]
  // CSV prices already include adjustments (Adj Close).
  adjusted: boolean
  updatedAt: string
}

const STOCK_DAY = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY'
const TWT49U = 'https://www.twse.com.tw/exchangeReport/TWT49U'
// TWSE blocks clients that send more than ~3 requests per 5 seconds.
export const TWSE_REQUEST_GAP_MS = 2000
const CACHE_PREFIX = 'pfm:prices:'

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// "115/09/01" (ROC) → "2026-09-01"
function rocSlashDate(roc: string): string {
  const [y, m, d] = roc.split('/').map((x) => Number(x))
  return `${y + 1911}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// "114年01月17日" → "2025-01-17"
export function rocChineseDate(roc: string): string {
  const match = /(\d+)年(\d+)月(\d+)日/.exec(roc)
  if (!match) return ''
  return `${Number(match[1]) + 1911}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

interface TwseTable {
  stat: string
  data?: string[][]
}

// STOCK_DAY rows: 日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, …
// Days without trades show "--" and are skipped.
export function parseStockDay(json: TwseTable): Bar[] {
  if (json.stat !== 'OK' || !json.data) return []
  return json.data
    .map((row) => ({
      date: rocSlashDate(row[0]),
      open: parseNumber(row[3]),
      high: parseNumber(row[4]),
      low: parseNumber(row[5]),
      close: parseNumber(row[6]),
      volume: parseNumber(row[1]),
    }))
    .filter((b) => b.close > 0 && b.open > 0)
}

// TWT49U rows: 資料日期, 股票代號, 股票名稱, 除權息前收盤價, 除權息參考價, …
export function parseExRights(json: TwseTable): Record<string, PriceEvent[]> {
  const out: Record<string, PriceEvent[]> = {}
  if (json.stat !== 'OK' || !json.data) return out
  for (const row of json.data) {
    const before = parseNumber(row[3])
    const reference = parseNumber(row[4])
    const date = rocChineseDate(row[0])
    if (!date || !(before > 0) || !(reference > 0)) continue
    ;(out[row[1].trim()] ??= []).push({ date, factor: reference / before })
  }
  return out
}

// Yahoo Finance style CSV: Date,Open,High,Low,Close,Adj Close,Volume.
// OHLC are scaled by Adj Close ÷ Close so the series includes dividends
// and splits.
export function parseCsvBars(text: string): Bar[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) throw new Error('CSV 沒有資料列')
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''))
  const col = (name: string) => header.indexOf(name)
  const iDate = col('date')
  const iOpen = col('open')
  const iHigh = col('high')
  const iLow = col('low')
  const iClose = col('close')
  const iAdj = col('adj close')
  const iVol = col('volume')
  if (iDate < 0 || iClose < 0) throw new Error('CSV 需要 Date 與 Close 欄位（Yahoo Finance 格式）')
  const bars: Bar[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((c) => c.trim().replace(/"/g, ''))
    const close = Number(cells[iClose])
    const date = cells[iDate].slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(close > 0)) continue
    const adj = iAdj >= 0 ? Number(cells[iAdj]) : close
    const k = adj > 0 ? adj / close : 1
    const num = (i: number) => (i >= 0 && Number(cells[i]) > 0 ? Number(cells[i]) : close)
    bars.push({
      date,
      open: num(iOpen) * k,
      high: num(iHigh) * k,
      low: num(iLow) * k,
      close: close * k,
      volume: iVol >= 0 ? Number(cells[iVol]) || 0 : 0,
    })
  }
  if (bars.length === 0) throw new Error('CSV 沒有可用的價格資料')
  return bars.sort((a, b) => a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// Adjustment
// ---------------------------------------------------------------------------

// Taiwan stocks move at most ±10% a day, so an overnight gap far beyond
// that is a corporate action. Splits (e.g. 0050's 1→4 in 2025) are not in
// TWT49U; detect them as gaps close to a whole-number ratio.
export function detectSplits(bars: Bar[], known: PriceEvent[] = []): PriceEvent[] {
  const knownDates = new Set(known.map((e) => e.date))
  const out: PriceEvent[] = []
  for (let i = 1; i < bars.length; i++) {
    if (knownDates.has(bars[i].date)) continue
    const ratio = bars[i - 1].close / bars[i].open
    for (const r of [ratio, 1 / ratio]) {
      if (r < 1.6) continue
      const k = Math.round(r)
      if (k >= 2 && Math.abs(r - k) / k < 0.08) {
        out.push({ date: bars[i].date, factor: r === ratio ? 1 / k : k })
      }
    }
  }
  return out
}

// Back-adjusts prices so that returns include dividends and splits: every
// bar before an event is scaled by that event's factor.
export function adjustBars(bars: Bar[], events: PriceEvent[]): Bar[] {
  if (events.length === 0) return bars
  const sorted = [...events].sort((x, y) => x.date.localeCompare(y.date))
  const out = new Array<Bar>(bars.length)
  let e = sorted.length - 1
  let factor = 1
  for (let i = bars.length - 1; i >= 0; i--) {
    // An event's date is the ex-date: bars strictly before it are scaled.
    while (e >= 0 && sorted[e].date > bars[i].date) factor *= sorted[e--].factor
    const b = bars[i]
    out[i] = { ...b, open: b.open * factor, high: b.high * factor, low: b.low * factor, close: b.close * factor }
  }
  return out
}

export function seriesForBacktest(series: PriceSeries): { bars: Bar[]; adjusted: boolean } {
  if (series.adjusted) return { bars: series.bars, adjusted: true }
  const events = [...series.events, ...detectSplits(series.bars, series.events)]
  return { bars: adjustBars(series.bars, events), adjusted: true }
}

// ---------------------------------------------------------------------------
// Cache (localStorage, outside the main app data and its export)
// ---------------------------------------------------------------------------

export function loadSeries(symbol: string): PriceSeries | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + symbol)
    if (!raw) return null
    const s = JSON.parse(raw) as Omit<PriceSeries, 'bars'> & { bars: [string, number, number, number, number, number][] }
    return {
      ...s,
      bars: s.bars.map(([date, open, high, low, close, volume]) => ({ date, open, high, low, close, volume })),
    }
  } catch {
    return null
  }
}

export function saveSeries(series: PriceSeries): boolean {
  try {
    const compact = { ...series, bars: series.bars.map((b) => [b.date, b.open, b.high, b.low, b.close, b.volume]) }
    localStorage.setItem(CACHE_PREFIX + series.symbol, JSON.stringify(compact))
    return true
  } catch {
    // Quota exceeded or storage blocked: the data still works this session.
    return false
  }
}

export function removeSeries(symbol: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + symbol)
  } catch {
    // ignore
  }
}

export function importCsvSeries(symbol: string, text: string): PriceSeries {
  const series: PriceSeries = {
    symbol,
    source: 'csv',
    bars: parseCsvBars(text),
    months: [],
    events: [],
    adjusted: true,
    updatedAt: new Date().toISOString(),
  }
  saveSeries(series)
  return series
}

// ---------------------------------------------------------------------------
// TWSE download
// ---------------------------------------------------------------------------

export function monthsInRange(start: string, end: string): string[] {
  const out: string[] = []
  let [y, m] = start.slice(0, 7).split('-').map(Number)
  const [ey, em] = end.slice(0, 7).split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

export interface FetchDeps {
  fetchJson: (url: string) => Promise<TwseTable>
  sleep: (ms: number) => Promise<void>
}

const defaultDeps: FetchDeps = {
  fetchJson: async (url) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`證交所請求失敗：${response.status}`)
    return response.json()
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export interface FetchProgress {
  symbol: string
  done: number
  total: number
}

// Downloads (incrementally) the daily bars and ex-rights events of a
// TWSE-listed code between start and end, caching the result.
export async function fetchTwseSeries(
  code: string,
  start: string,
  end: string,
  onProgress?: (p: FetchProgress) => void,
  deps: FetchDeps = defaultDeps,
): Promise<PriceSeries> {
  const symbol = `TW:${code}`
  const cached = loadSeries(symbol)
  const currentMonth = end.slice(0, 7)
  const have = new Set((cached?.months ?? []).filter((m) => m !== currentMonth))
  const months = monthsInRange(start, end).filter((m) => !have.has(m))
  const years = [...new Set(months.map((m) => m.slice(0, 4)))]
  const total = months.length + years.length
  let done = 0
  const byDate = new Map((cached?.bars ?? []).map((b) => [b.date, b]))
  const events = new Map((cached?.events ?? []).map((e) => [e.date, e]))

  let first = true
  const request = async (url: string) => {
    if (!first) await deps.sleep(TWSE_REQUEST_GAP_MS)
    first = false
    const json = await deps.fetchJson(url)
    done += 1
    onProgress?.({ symbol, done, total })
    return json
  }

  for (const month of months) {
    const params = new URLSearchParams({ response: 'json', date: `${month.replace('-', '')}01`, stockNo: code })
    for (const bar of parseStockDay(await request(`${STOCK_DAY}?${params}`))) byDate.set(bar.date, bar)
  }
  for (const year of years) {
    const yStart = year === start.slice(0, 4) ? start : `${year}-01-01`
    const yEnd = year === end.slice(0, 4) ? end : `${year}-12-31`
    const params = new URLSearchParams({
      response: 'json',
      startDate: yStart.replace(/-/g, ''),
      endDate: yEnd.replace(/-/g, ''),
    })
    for (const e of parseExRights(await request(`${TWT49U}?${params}`))[code] ?? []) events.set(e.date, e)
  }

  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (bars.length === 0) throw new Error(`證交所查無 ${code} 的日線資料（上櫃股票請改用 CSV 匯入）`)
  const series: PriceSeries = {
    symbol,
    source: 'twse',
    bars,
    months: [...new Set([...(cached?.months ?? []), ...months])].sort(),
    events: [...events.values()].sort((a, b) => a.date.localeCompare(b.date)),
    adjusted: false,
    updatedAt: new Date().toISOString(),
  }
  saveSeries(series)
  return series
}

export function isoDaysAgo(today: string, years: number): string {
  const [y, m, d] = today.split('-').map(Number)
  return `${y - years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

