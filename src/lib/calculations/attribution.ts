import type {
  Holding,
  InvestmentPolicy,
  PerformanceReview,
  Sleeve,
  SleevePerformance,
  Trade,
} from '../storage/schema'
import { isSatellite } from './portfolioRisk'

export type AssetClass = 'tw' | 'global' | 'bondCash'

export const SLEEVE_ASSET_CLASS: Record<Sleeve, AssetClass> = {
  core_tw: 'tw',
  satellite_tw: 'tw',
  core_global: 'global',
  satellite_us: 'global',
  core_bond_cash: 'bondCash',
}

const ASSET_CLASSES: AssetClass[] = ['tw', 'global', 'bondCash']

export interface PeriodAttribution {
  review: PerformanceReview
  portfolioReturn: number
  benchmarkReturn: number
  excessReturn: number
  allocationEffect: number
  selectionEffect: number
  otherEffect: number
  satelliteReturn: number | null
  satelliteBenchmarkReturn: number | null
}

export interface AttributionSummary {
  periods: PeriodAttribution[]
  cumulativeReturn: number
  cumulativeBenchmarkReturn: number
  maxDrawdown: number
  sharpeRatio: number | null
  yearlySatellite: { year: string; satelliteReturn: number; benchmarkReturn: number }[]
  consecutiveSatelliteLaggingYears: number
}

// Modified Dietz: flows are assumed to land mid-period. Returns a fraction.
export function modifiedDietz(start: number, end: number, netFlow: number): number {
  const denominator = start + netFlow / 2
  if (denominator <= 0) return 0
  return (end - start - netFlow) / denominator
}

function aggregate(rows: SleevePerformance[]): { start: number; end: number; flow: number } {
  return rows.reduce(
    (acc, r) => ({ start: acc.start + r.startValue, end: acc.end + r.endValue, flow: acc.flow + r.netFlow }),
    { start: 0, end: 0, flow: 0 },
  )
}

// The benchmark is the passive alternative: everything in core ETFs at the
// IPS core weights, normalized to 100%.
export function benchmarkWeights(policy: InvestmentPolicy): Record<AssetClass, number> {
  const total = policy.coreTwEquityPercent + policy.coreGlobalEquityPercent + policy.coreBondCashPercent
  if (total <= 0) return { tw: 0, global: 0, bondCash: 0 }
  return {
    tw: policy.coreTwEquityPercent / total,
    global: policy.coreGlobalEquityPercent / total,
    bondCash: policy.coreBondCashPercent / total,
  }
}

export function attributePeriod(review: PerformanceReview, policy: InvestmentPolicy): PeriodAttribution {
  const b: Record<AssetClass, number> = {
    tw: review.benchmarkReturns.tw / 100,
    global: review.benchmarkReturns.global / 100,
    bondCash: review.benchmarkReturns.bondCash / 100,
  }
  const target = benchmarkWeights(policy)
  const benchmarkReturn = ASSET_CLASSES.reduce((acc, c) => acc + target[c] * b[c], 0)

  const total = aggregate(review.sleeves)
  const portfolioReturn = modifiedDietz(total.start, total.end, total.flow)
  // Weights come from the starting values (or ending values for a first
  // period that starts from zero).
  const weightBase = total.start > 0 ? 'startValue' : 'endValue'
  const weightTotal = total.start > 0 ? total.start : total.end

  let allocationEffect = 0
  let selectionEffect = 0
  for (const c of ASSET_CLASSES) {
    const rows = review.sleeves.filter((s) => SLEEVE_ASSET_CLASS[s.sleeve] === c)
    const agg = aggregate(rows)
    const weight = weightTotal > 0 ? rows.reduce((acc, r) => acc + r[weightBase], 0) / weightTotal : 0
    const classReturn = modifiedDietz(agg.start, agg.end, agg.flow)
    allocationEffect += (weight - target[c]) * (b[c] - benchmarkReturn)
    selectionEffect += weight * (classReturn - b[c])
  }

  const satelliteRows = review.sleeves.filter((s) => isSatellite(s.sleeve))
  const sat = aggregate(satelliteRows)
  const satBase = sat.start > 0 ? sat.start : sat.end
  const satelliteReturn = satBase > 0 ? modifiedDietz(sat.start, sat.end, sat.flow) : null
  const satelliteBenchmarkReturn =
    satBase > 0
      ? satelliteRows.reduce(
          (acc, r) =>
            acc + ((sat.start > 0 ? r.startValue : r.endValue) / satBase) * b[SLEEVE_ASSET_CLASS[r.sleeve]],
          0,
        )
      : null

  const excessReturn = portfolioReturn - benchmarkReturn
  return {
    review,
    portfolioReturn,
    benchmarkReturn,
    excessReturn,
    allocationEffect,
    selectionEffect,
    otherEffect: excessReturn - allocationEffect - selectionEffect,
    satelliteReturn,
    satelliteBenchmarkReturn,
  }
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000
}

export function summarizeAttribution(
  reviews: PerformanceReview[],
  policy: InvestmentPolicy,
  riskFreeAnnualPercent = 1.5,
): AttributionSummary {
  const periods = [...reviews]
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    .map((r) => attributePeriod(r, policy))

  let index = 1
  let benchIndex = 1
  let peak = 1
  let maxDrawdown = 0
  for (const p of periods) {
    index *= 1 + p.portfolioReturn
    benchIndex *= 1 + p.benchmarkReturn
    peak = Math.max(peak, index)
    maxDrawdown = Math.min(maxDrawdown, index / peak - 1)
  }

  let sharpeRatio: number | null = null
  if (periods.length >= 4) {
    const avgDays =
      periods.reduce((acc, p) => acc + Math.max(daysBetween(p.review.periodStart, p.review.periodEnd), 1), 0) /
      periods.length
    const perYear = 365 / avgDays
    const rf = (1 + riskFreeAnnualPercent / 100) ** (1 / perYear) - 1
    const excess = periods.map((p) => p.portfolioReturn - rf)
    const mean = excess.reduce((a, v) => a + v, 0) / excess.length
    const variance = excess.reduce((a, v) => a + (v - mean) ** 2, 0) / (excess.length - 1)
    const sd = Math.sqrt(variance)
    sharpeRatio = sd > 0 ? (mean / sd) * Math.sqrt(perYear) : null
  }

  const byYear = new Map<string, { sat: number; bench: number }>()
  for (const p of periods) {
    if (p.satelliteReturn === null || p.satelliteBenchmarkReturn === null) continue
    const year = p.review.periodEnd.slice(0, 4)
    const acc = byYear.get(year) ?? { sat: 1, bench: 1 }
    byYear.set(year, {
      sat: acc.sat * (1 + p.satelliteReturn),
      bench: acc.bench * (1 + p.satelliteBenchmarkReturn),
    })
  }
  const yearlySatellite = [...byYear.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, v]) => ({ year, satelliteReturn: v.sat - 1, benchmarkReturn: v.bench - 1 }))

  let consecutiveSatelliteLaggingYears = 0
  for (let i = yearlySatellite.length - 1; i >= 0; i--) {
    if (yearlySatellite[i].satelliteReturn >= yearlySatellite[i].benchmarkReturn) break
    consecutiveSatelliteLaggingYears += 1
  }

  return {
    periods,
    cumulativeReturn: index - 1,
    cumulativeBenchmarkReturn: benchIndex - 1,
    maxDrawdown,
    sharpeRatio,
    yearlySatellite,
    consecutiveSatelliteLaggingYears,
  }
}

// Net TWD flow into each sleeve from trades dated within (start, end].
export function netFlowsBySleeve(
  trades: Trade[],
  holdings: Holding[],
  start: string,
  end: string,
  fxUsdTwd: number,
): Record<Sleeve, number> {
  const flows: Record<Sleeve, number> = {
    core_tw: 0,
    core_global: 0,
    core_bond_cash: 0,
    satellite_tw: 0,
    satellite_us: 0,
  }
  const sleeveOf = new Map(holdings.map((h) => [h.id, h.sleeve]))
  for (const t of trades) {
    if (t.date <= start || t.date > end || !t.holdingId) continue
    const sleeve = sleeveOf.get(t.holdingId)
    if (!sleeve) continue
    const amount = t.shares * t.price * (t.currency === 'USD' ? fxUsdTwd : 1)
    flows[sleeve] += t.side === 'buy' ? amount : -amount
  }
  return flows
}
