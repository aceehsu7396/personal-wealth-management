import { detectSplits, type Bar } from '../market/priceHistory'
import type { DividendRow } from './fundamentals'

// An ETF's health check from FinMind prices and distributions: total
// return (dividends reinvested), risk, payout and how it compares with
// 0050. Splits (e.g. 0050's 1→4 in 2025) are detected from price gaps.

export interface PriceRow {
  date: string
  open: number
  max: number
  min: number
  close: number
  Trading_money: number
}

export interface EtfProfile {
  asOf: string
  historyYears: number
  // Annualized total returns (%), null when the history is shorter.
  returns: { y1: number | null; y3: number | null; y5: number | null }
  volatility: number | null
  maxDrawdown: number | null
  yieldTtm: number | null
  distributions12m: number
  distributionYears: number
  // Average daily turnover over the last 20 days (億元).
  avgTradeValue: number | null
  vs0050: { excess3y: number | null; correlation: number | null; beta: number | null } | null
}

interface Daily {
  date: string
  close: number
  // Total-return index (starts at 1).
  tr: number
}

// Total-return index: on an ex-date the distribution is reinvested; on a
// split date the previous close is rescaled.
export function totalReturnSeries(prices: PriceRow[], dividends: DividendRow[]): Daily[] {
  const sorted = [...prices].filter((p) => p.close > 0).sort((a, b) => a.date.localeCompare(b.date))
  const bars: Bar[] = sorted.map((p) => ({ date: p.date, open: p.open || p.close, high: p.max, low: p.min, close: p.close, volume: 0 }))
  const splits = new Map(detectSplits(bars).map((e) => [e.date, e.factor]))
  const cash = new Map<string, number>()
  for (const d of dividends) {
    const amount = (d.CashEarningsDistribution ?? 0) + (d.CashStatutorySurplus ?? 0)
    if (amount > 0 && d.CashExDividendTradingDate) cash.set(d.CashExDividendTradingDate, (cash.get(d.CashExDividendTradingDate) ?? 0) + amount)
  }
  const out: Daily[] = []
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]
    if (i === 0) {
      out.push({ date: p.date, close: p.close, tr: 1 })
      continue
    }
    const prevClose = sorted[i - 1].close * (splits.get(p.date) ?? 1)
    const gross = (p.close + (cash.get(p.date) ?? 0)) / prevClose
    out.push({ date: p.date, close: p.close, tr: out[i - 1].tr * gross })
  }
  return out
}

function yearsBefore(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) - years}${date.slice(4)}`
}

function annualized(series: Daily[], years: number): number | null {
  const last = series[series.length - 1]
  const from = yearsBefore(last.date, years)
  const start = series.find((d) => d.date >= from)
  if (!start || series[0].date > from) return null
  return ((last.tr / start.tr) ** (1 / years) - 1) * 100
}

function dailyReturns(series: Daily[]): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 1; i < series.length; i++) out.set(series[i].date, series[i].tr / series[i - 1].tr - 1)
  return out
}

function stdev(values: number[]): number {
  const mean = values.reduce((a, v) => a + v, 0) / values.length
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1))
}

const round = (v: number | null, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d)

export function analyzeEtf(input: {
  prices: PriceRow[]
  dividends: DividendRow[]
  benchmark?: { prices: PriceRow[]; dividends: DividendRow[] }
  today: string
}): EtfProfile | null {
  const series = totalReturnSeries(input.prices, input.dividends)
  if (series.length < 20) return null
  const last = series[series.length - 1]
  const historyYears = (Date.parse(last.date) - Date.parse(series[0].date)) / (365.25 * 86_400_000)

  const threeYearsAgo = yearsBefore(last.date, 3)
  const recent = series.filter((d) => d.date >= threeYearsAgo)
  const returns = [...dailyReturns(recent).values()]
  let peak = 0
  let maxDrawdown = 0
  for (const d of series) {
    peak = Math.max(peak, d.tr)
    maxDrawdown = Math.min(maxDrawdown, d.tr / peak - 1)
  }

  // Distributions in the last 12 months, rescaled if a split came after.
  const sortedPrices = [...input.prices].sort((a, b) => a.date.localeCompare(b.date))
  const splits = detectSplits(sortedPrices.map((p) => ({ date: p.date, open: p.open || p.close, high: p.max, low: p.min, close: p.close, volume: 0 })))
  const yearAgo = yearsBefore(input.today, 1)
  let cash12m = 0
  let count12m = 0
  const years = new Set<string>()
  for (const d of input.dividends) {
    const amount = (d.CashEarningsDistribution ?? 0) + (d.CashStatutorySurplus ?? 0)
    const date = d.CashExDividendTradingDate
    if (!amount || !date) continue
    years.add(date.slice(0, 4))
    if (date > yearAgo && date <= input.today) {
      const factor = splits.filter((s) => s.date > date).reduce((a, s) => a * s.factor, 1)
      cash12m += amount * factor
      count12m++
    }
  }
  let distributionYears = 0
  let y = Number(input.today.slice(0, 4))
  if (!years.has(String(y))) y--
  while (years.has(String(y))) {
    distributionYears++
    y--
  }
  const tail = sortedPrices.slice(-20)
  const avgTradeValue = tail.length > 0 ? tail.reduce((a, p) => a + (p.Trading_money ?? 0), 0) / tail.length / 1e8 : null

  let vs0050: EtfProfile['vs0050'] = null
  if (input.benchmark) {
    const bench = totalReturnSeries(input.benchmark.prices, input.benchmark.dividends)
    const benchRecent = bench.filter((d) => d.date >= threeYearsAgo)
    const own = dailyReturns(recent)
    const other = dailyReturns(benchRecent)
    const pairs = [...own.entries()].filter(([d]) => other.has(d)).map(([d, r]) => [r, other.get(d)!] as const)
    if (pairs.length > 60) {
      const xs = pairs.map((p) => p[1])
      const ys = pairs.map((p) => p[0])
      const mx = xs.reduce((a, v) => a + v, 0) / xs.length
      const my = ys.reduce((a, v) => a + v, 0) / ys.length
      const cov = pairs.reduce((a, [yv, xv]) => a + (xv - mx) * (yv - my), 0) / (pairs.length - 1)
      const benchAnnual = annualized(bench, 3)
      const ownAnnual = annualized(series, 3)
      vs0050 = {
        excess3y: ownAnnual !== null && benchAnnual !== null ? round(ownAnnual - benchAnnual) : null,
        correlation: round(cov / (stdev(xs) * stdev(ys))),
        beta: round(cov / stdev(xs) ** 2),
      }
    }
  }

  return {
    asOf: last.date,
    historyYears: Math.round(historyYears * 10) / 10,
    returns: { y1: round(annualized(series, 1)), y3: round(annualized(series, 3)), y5: round(annualized(series, 5)) },
    volatility: returns.length > 20 ? round(stdev(returns) * Math.sqrt(252) * 100) : null,
    maxDrawdown: round(maxDrawdown * 100),
    yieldTtm: cash12m > 0 ? round((cash12m / last.close) * 100) : null,
    distributions12m: count12m,
    distributionYears,
    avgTradeValue: round(avgTradeValue),
    vs0050,
  }
}
