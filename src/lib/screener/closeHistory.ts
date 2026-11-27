// The last year of daily closes for every listed code, kept in
// public/data/stock-closes.json by scripts/stocks-data.mts: each run adds
// the day's closes and back-fills a few missing days, so a year builds up
// over the first runs. The screener's volatility and 52-week-high columns
// come from it.

export interface CloseHistory {
  // Trading days, oldest first; closes[code][i] belongs to dates[i].
  dates: string[]
  closes: Record<string, (number | null)[]>
  // Weekdays already asked that had no trading (holidays, typhoons).
  closed: string[]
}

export const HISTORY_DAYS = 252
// Enough of the year must be there before a value is shown.
const MIN_DAYS = 240

export const emptyHistory = (): CloseHistory => ({ dates: [], closes: {}, closed: [] })

// Adds one day's closes (replacing that day if present), keeps the dates
// in order and drops what is older than the window.
export function addDay(h: CloseHistory, date: string, closes: Map<string, number>): CloseHistory {
  const byDate = new Map<string, Map<string, number | null>>()
  h.dates.forEach((d, i) => {
    const m = new Map<string, number | null>()
    for (const [code, series] of Object.entries(h.closes)) if (series[i] != null) m.set(code, series[i])
    byDate.set(d, m)
  })
  byDate.set(date, new Map(closes))
  const dates = [...byDate.keys()].sort().slice(-HISTORY_DAYS)
  const codes = new Set<string>()
  for (const d of dates) for (const code of byDate.get(d)!.keys()) codes.add(code)
  const out: CloseHistory['closes'] = {}
  for (const code of codes) out[code] = dates.map((d) => byDate.get(d)!.get(code) ?? null)
  const oldest = dates[0] ?? date
  return { dates, closes: out, closed: h.closed.filter((d) => d >= oldest && !byDate.has(d)) }
}

// Weekdays in the year before `date` neither in the history nor known
// closed, newest first: what a run should still download.
export function missingDays(h: CloseHistory, date: string): string[] {
  const have = new Set([...h.dates, ...h.closed])
  const out: string[] = []
  const d = new Date(`${date}T00:00:00Z`)
  const stop = new Date(d)
  stop.setUTCDate(stop.getUTCDate() - 366)
  for (d.setUTCDate(d.getUTCDate() - 1); d > stop; d.setUTCDate(d.getUTCDate() - 1)) {
    const wd = d.getUTCDay()
    const iso = d.toISOString().slice(0, 10)
    if (wd !== 0 && wd !== 6 && !have.has(iso)) out.push(iso)
  }
  return out
}

export interface YearStats {
  vol1y: number | null
  fromHigh52: number | null
}

// Annualized volatility and distance from the year's highest close. A
// day-to-day move beyond what the ±10% price limit allows is a split or
// capital change, not a market move: such a series gets no values.
export function yearStats(series: (number | null)[]): YearStats {
  const closes = series.filter((c): c is number => c != null && c > 0)
  if (closes.length < MIN_DAYS) return { vol1y: null, fromHigh52: null }
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const r = Math.log(closes[i] / closes[i - 1])
    if (Math.abs(r) > Math.log(1.11)) return { vol1y: null, fromHigh52: null }
    rets.push(r)
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)
  const last = closes[closes.length - 1]
  return { vol1y: Math.sqrt(variance * 252), fromHigh52: last / Math.max(...closes) - 1 }
}
