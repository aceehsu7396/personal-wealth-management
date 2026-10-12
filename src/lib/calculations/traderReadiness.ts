import type {
  FireAssumptions,
  Foundation,
  Holding,
  InvestmentPolicy,
  PerformanceReview,
  Trade,
} from '../storage/schema'
import { attributePeriod } from './attribution'
import { addMonths } from './disciplineScore'
import { isSatellite } from './portfolioRisk'

// Thresholds for going full time (handbook chapter 11).
export const READINESS_RULES = {
  trackRecordMonths: 24,
  closedTrades: 30,
  disciplineScore: 80,
} as const

export interface FullTimeTarget {
  annualExpenses: number
  // Investable assets needed: living costs ÷ sustainable withdrawal rate.
  portfolioTarget: number
  // Cash kept outside the portfolio so a bad year never forces selling.
  bufferTarget: number
}

export function fullTimeTarget(assumptions: FireAssumptions, foundation: Foundation): FullTimeTarget {
  const annualExpenses = assumptions.targetAnnualExpensesOverride ?? assumptions.monthlyExpenses * 12
  const rate = assumptions.safeWithdrawalRatePercent / 100
  return {
    annualExpenses,
    portfolioTarget: rate > 0 ? annualExpenses / rate : Infinity,
    bufferTarget: assumptions.monthlyExpenses * foundation.livingBufferMonths,
  }
}

export interface ReadinessItem {
  key: 'assets' | 'buffer' | 'trackRecord' | 'performance' | 'discipline'
  label: string
  met: boolean
  detail: string
}

export interface TraderReadiness {
  target: FullTimeTarget
  items: ReadinessItem[]
  metCount: number
  ready: boolean
}

export interface ReadinessInput {
  assumptions: FireAssumptions
  foundation: Foundation
  holdings: Holding[]
  trades: Trade[]
  performanceReviews: PerformanceReview[]
  policy: InvestmentPolicy
  disciplineScore: number | null
  today: string
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0)
}

// Real-money trades in the trading sleeve (satellite holdings).
export function tradingSleeveTrades(trades: Trade[], holdings: Holding[]): Trade[] {
  const sleeveOf = new Map(holdings.map((h) => [h.id, h.sleeve]))
  return trades.filter((t) => t.holdingId !== undefined && isSatellite(sleeveOf.get(t.holdingId) ?? 'core_tw'))
}

export interface SleeveTrackRecord {
  years: number
  annualReturn: number
  benchmarkAnnualReturn: number
  maxDrawdown: number
}

// Trading-sleeve returns over the last `months` of quarterly reviews,
// annualized, with the drawdown of the chained quarterly index.
export function sleeveTrackRecord(
  reviews: PerformanceReview[],
  policy: InvestmentPolicy,
  today: string,
  months = READINESS_RULES.trackRecordMonths,
): SleeveTrackRecord | null {
  const since = addMonths(today, -months)
  const periods = [...reviews]
    .filter((r) => r.periodEnd > since)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    .map((r) => attributePeriod(r, policy))
    .filter((p) => p.satelliteReturn !== null && p.satelliteBenchmarkReturn !== null)
  if (periods.length === 0) return null

  let index = 1
  let bench = 1
  let peak = 1
  let maxDrawdown = 0
  let days = 0
  for (const p of periods) {
    index *= 1 + (p.satelliteReturn ?? 0)
    bench *= 1 + (p.satelliteBenchmarkReturn ?? 0)
    peak = Math.max(peak, index)
    maxDrawdown = Math.min(maxDrawdown, index / peak - 1)
    days += Math.max((Date.parse(p.review.periodEnd) - Date.parse(p.review.periodStart)) / 86_400_000, 1)
  }
  const years = days / 365
  return {
    years,
    annualReturn: index ** (1 / years) - 1,
    benchmarkAnnualReturn: bench ** (1 / years) - 1,
    maxDrawdown,
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function twd(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString('zh-TW')} 元` : '—'
}

// The five gates for leaving the day job (handbook chapter 11). All five
// must hold before trading becomes the only income.
export function computeTraderReadiness(input: ReadinessInput): TraderReadiness {
  const { assumptions, foundation, policy, today } = input
  const target = fullTimeTarget(assumptions, foundation)

  const sleeveTrades = tradingSleeveTrades(input.trades, input.holdings)
  const firstBuy = sleeveTrades
    .filter((t) => t.side === 'buy')
    .map((t) => t.date)
    .sort()[0]
  const recordMonths = firstBuy ? Math.max(monthsBetween(firstBuy, today), 0) : 0
  const closed = sleeveTrades.filter((t) => t.side === 'sell').length

  const record = sleeveTrackRecord(input.performanceReviews, policy, today)
  const coversPeriod = record !== null && record.years >= (READINESS_RULES.trackRecordMonths / 12) * 0.9
  const beats = record !== null && record.annualReturn > record.benchmarkAnnualReturn
  const withinDrawdown = record !== null && -record.maxDrawdown * 100 <= policy.maxDrawdownTolerancePercent

  const items: ReadinessItem[] = [
    {
      key: 'assets',
      label: '資產達全職門檻',
      met: target.annualExpenses > 0 && assumptions.currentNetWorth >= target.portfolioTarget,
      detail:
        target.annualExpenses > 0
          ? `投資組合 ${twd(assumptions.currentNetWorth)}／門檻 ${twd(target.portfolioTarget)}（年生活費 ÷ 提領率 ${assumptions.safeWithdrawalRatePercent}%）`
          : '先在全職門檻試算填寫每月生活費',
    },
    {
      key: 'buffer',
      label: `生活費緩衝 ${foundation.livingBufferMonths} 個月`,
      met: target.bufferTarget > 0 && foundation.emergencyFundAmount >= target.bufferTarget,
      detail: `目前 ${twd(foundation.emergencyFundAmount)}／目標 ${twd(target.bufferTarget)}（放在現金或短債，不計入投資組合）`,
    },
    {
      key: 'trackRecord',
      label: `實單紀錄 ${READINESS_RULES.trackRecordMonths} 個月、${READINESS_RULES.closedTrades} 筆平倉`,
      met: recordMonths >= READINESS_RULES.trackRecordMonths && closed >= READINESS_RULES.closedTrades,
      detail: `已 ${recordMonths} 個月、${closed} 筆平倉交易`,
    },
    {
      key: 'performance',
      label: '交易部位勝過基準，回撤在上限內',
      met: coversPeriod && beats && withinDrawdown,
      detail: record
        ? `近 ${record.years.toFixed(1)} 年年化 ${pct(record.annualReturn)} vs 基準 ${pct(record.benchmarkAnnualReturn)}，最大回撤 ${pct(record.maxDrawdown)}（上限 −${policy.maxDrawdownTolerancePercent}%）${coversPeriod ? '' : '；季度績效歸因需涵蓋 2 年'}`
        : '需要涵蓋近 2 年的季度績效歸因',
    },
    {
      key: 'discipline',
      label: `紀律分數 ≥ ${READINESS_RULES.disciplineScore}`,
      met: (input.disciplineScore ?? 0) >= READINESS_RULES.disciplineScore,
      detail: `目前 ${input.disciplineScore ?? '—'}`,
    },
  ]
  const metCount = items.filter((i) => i.met).length
  return { target, items, metCount, ready: metCount === items.length }
}
