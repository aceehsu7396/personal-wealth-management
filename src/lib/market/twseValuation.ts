import { yyyymmdd } from './twse'

// Daily valuation table for every TWSE-listed stock (not ETFs): close,
// dividend yield, P/E, P/B and the financial-report period they are based on.
const VALUATION_ENDPOINT = 'https://www.twse.com.tw/exchangeReport/BWIBBU_d'
const MAX_DAYS_BACK = 7

export interface TwseValuation {
  ticker: string
  name: string
  close: number | null
  dividendYield: number | null
  pe: number | null
  pb: number | null
  period: string
  date: string
}

interface TwseTableResponse {
  stat: string
  fields?: string[]
  data?: (string | number)[][]
}

// TWSE uses "-" or an empty string for "not available" and thousands
// separators in prices.
export function parseOptionalNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = value.replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function columnIndex(fields: string[], prefix: string): number {
  return fields.findIndex((f) => f.startsWith(prefix))
}

export function parseValuationResponse(
  json: TwseTableResponse,
  isoDate: string,
): Record<string, TwseValuation> | null {
  if (json.stat !== 'OK' || !json.data || !json.fields) return null
  const f = json.fields
  const idx = {
    ticker: columnIndex(f, '證券代號'),
    name: columnIndex(f, '證券名稱'),
    close: columnIndex(f, '收盤價'),
    yield: columnIndex(f, '殖利率'),
    pe: columnIndex(f, '本益比'),
    pb: columnIndex(f, '股價淨值比'),
    period: columnIndex(f, '財報年'),
  }
  if (idx.ticker < 0) return null
  const out: Record<string, TwseValuation> = {}
  for (const row of json.data) {
    const ticker = String(row[idx.ticker]).trim()
    out[ticker] = {
      ticker,
      name: idx.name >= 0 ? String(row[idx.name]).trim() : '',
      close: idx.close >= 0 ? parseOptionalNumber(row[idx.close]) : null,
      dividendYield: idx.yield >= 0 ? parseOptionalNumber(row[idx.yield]) : null,
      pe: idx.pe >= 0 ? parseOptionalNumber(row[idx.pe]) : null,
      pb: idx.pb >= 0 ? parseOptionalNumber(row[idx.pb]) : null,
      period: idx.period >= 0 ? String(row[idx.period]).trim() : '',
      date: isoDate,
    }
  }
  return out
}

function isoOf(date: Date): string {
  const s = yyyymmdd(date)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

// Walks back from `from` until a trading day returns data (weekends and
// holidays return a non-OK stat).
export async function fetchTwseValuations(
  from: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ date: string; valuations: Record<string, TwseValuation> } | null> {
  for (let back = 0; back < MAX_DAYS_BACK; back++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() - back)
    const params = new URLSearchParams({ response: 'json', date: yyyymmdd(day), selectType: 'ALL' })
    const response = await fetchImpl(`${VALUATION_ENDPOINT}?${params.toString()}`)
    if (!response.ok) throw new Error(`TWSE 請求失敗：${response.status}`)
    const valuations = parseValuationResponse(await response.json(), isoOf(day))
    if (valuations) return { date: isoOf(day), valuations }
  }
  return null
}
