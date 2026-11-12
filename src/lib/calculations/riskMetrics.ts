import type { InvestmentPolicy, PortfolioSnapshot, TradePlan } from '../storage/schema'

// Risk numbers for the risk page (blueprint 02 §5.1): volatility, beta,
// historical VaR and CVaR, concentration, correlations, risk contribution
// and the trading sleeve's risk budget. Returns are daily simple returns on
// a shared calendar; weights are current portfolio weights.

export const TRADING_DAYS = 252
export const MONTH_DAYS = 21
export const CONFIDENCE = 0.95

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  let s = 0
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb)
  return s / (n - 1)
}

export const stdev = (xs: number[]) => Math.sqrt(covariance(xs, xs))
export const annualVol = (daily: number[]) => stdev(daily) * Math.sqrt(TRADING_DAYS)

export function beta(asset: number[], market: number[]): number | null {
  const v = covariance(market, market)
  return v > 0 ? covariance(asset, market) / v : null
}

export function correlation(a: number[], b: number[]): number | null {
  const d = stdev(a) * stdev(b)
  return d > 0 ? covariance(a, b) / d : null
}

// Daily returns keyed by date from closes in date order.
export function returnsByDate(points: { date: string; close: number }[]): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 1; i < points.length; i++) if (points[i - 1].close > 0) out.set(points[i].date, points[i].close / points[i - 1].close - 1)
  return out
}

// One return per calendar date; a market closed that day counts as 0.
export const onCalendar = (calendar: string[], byDate: Map<string, number>) => calendar.map((d) => byDate.get(d) ?? 0)

// Overlapping n-day compounded returns, for a one-month horizon.
export function horizonReturns(daily: number[], n: number): number[] {
  const out: number[] = []
  for (let i = 0; i + n <= daily.length; i++) out.push(daily.slice(i, i + n).reduce((acc, r) => acc * (1 + r), 1) - 1)
  return out
}

// Historical VaR and CVaR as positive loss fractions.
export function varCvar(returns: number[], confidence = CONFIDENCE): { var: number; cvar: number } | null {
  if (returns.length < 20) return null
  const sorted = [...returns].sort((a, b) => a - b)
  const k = Math.max(1, Math.floor(sorted.length * (1 - confidence)))
  const tail = sorted.slice(0, k)
  return { var: Math.max(0, -sorted[k - 1]), cvar: Math.max(0, -mean(tail)) }
}

export function portfolioReturns(weights: number[], matrix: number[][]): number[] {
  const n = matrix[0]?.length ?? 0
  return Array.from({ length: n }, (_, t) => weights.reduce((s, w, i) => s + w * matrix[i][t], 0))
}

// Each position's share of portfolio variance (sums to 1).
export function riskContributions(weights: number[], matrix: number[][]): number[] {
  const cov = matrix.map((a) => matrix.map((b) => covariance(a, b)))
  const sigmaW = cov.map((row) => row.reduce((s, c, j) => s + c * weights[j], 0))
  const total = weights.reduce((s, w, i) => s + w * sigmaW[i], 0)
  return total > 0 ? weights.map((w, i) => (w * sigmaW[i]) / total) : weights.map(() => 0)
}

export function concentration(weights: number[]): { top5: number; hhi: number; effective: number } {
  const sorted = [...weights].sort((a, b) => b - a)
  const hhi = weights.reduce((s, w) => s + w * w, 0)
  return { top5: sorted.slice(0, 5).reduce((a, b) => a + b, 0), hhi, effective: hhi > 0 ? 1 / hhi : 0 }
}

// Drawdown from the recorded peak, the worst month-end drawdown, and days
// since the peak.
export function drawdownStats(snapshots: PortfolioSnapshot[], current: number, peak: number, peakDate: string | null, today: string) {
  let high = 0
  let worst = 0
  for (const s of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    high = Math.max(high, s.valueTwd)
    if (high > 0) worst = Math.min(worst, s.valueTwd / high - 1)
  }
  const top = Math.max(peak, current)
  const now = top > 0 ? current / top - 1 : 0
  return {
    current: now,
    worst: Math.min(worst, now),
    days: peakDate && now < 0 ? Math.max(0, Math.round((Date.parse(today) - Date.parse(peakDate)) / 86400000)) : 0,
  }
}

// Stop risk of every open plan against the trading sleeve's budget:
// per-trade risk × the open-position limit.
export function riskBudget(plans: TradePlan[], satelliteValueTwd: number, policy: InvestmentPolicy, fxUsdTwd: number) {
  const open = plans.filter((p) => p.status === 'open')
  const used = open.reduce((sum, p) => {
    const entry = p.fillPrice ?? p.entryPrice ?? 0
    const stop = p.currentStop ?? p.stopLoss ?? entry
    return sum + Math.max(0, entry - stop) * (p.shares ?? 0) * (p.market === 'US' ? fxUsdTwd : 1)
  }, 0)
  const budget = (satelliteValueTwd * policy.riskPerTradePercent * policy.maxOpenPositions) / 100
  return { used, budget, ratio: budget > 0 ? used / budget : 0, open: open.length }
}
