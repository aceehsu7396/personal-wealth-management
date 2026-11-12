import type { Holding, InvestmentPolicy, StockThesis, Trade, TradePlan } from '../storage/schema'
import { isSatellite } from './portfolioRisk'
import { evaluateThesis } from './thesisScoring'

export type ReviewSlot = 'review6m' | 'review12m'

export interface PendingReview {
  trade: Trade
  slot: ReviewSlot
  dueDate: string
}

export interface DisciplineReport {
  score: number | null
  tier: string
  complianceRate: number | null
  thesisCompletenessRate: number | null
  reviewCompletionRate: number | null
  exceptionTrades: Trade[]
  pendingReviews: PendingReview[]
  // Stop-loss exits filled well below the plan's stop.
  lateStops: number
}

const WEIGHTS = { compliance: 0.4, thesis: 0.3, review: 0.3 }

export function isException(trade: Trade): boolean {
  return trade.checklist.some((c) => !c.passed)
}

// Calendar arithmetic on the YYYY-MM-DD string itself, so the result does not
// shift with the local timezone. Day-of-month is clamped to the target month.
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const monthIndex = m - 1 + months
  const year = y + Math.floor(monthIndex / 12)
  const month = ((monthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Core DCA buys are mechanical and do not need a post-mortem.
export function reviewsDue(trades: Trade[], today: string): { due: PendingReview[]; done: number } {
  const due: PendingReview[] = []
  let done = 0
  for (const trade of trades) {
    if (trade.reason === 'core_dca') continue
    for (const [slot, months] of [
      ['review6m', 6],
      ['review12m', 12],
    ] as const) {
      const dueDate = addMonths(trade.date, months)
      if (dueDate > today) continue
      if (trade[slot]) done += 1
      else due.push({ trade, slot, dueDate })
    }
  }
  due.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return { due, done }
}

export function tierOf(score: number | null): string {
  if (score === null) return '尚無資料'
  if (score >= 90) return '優秀：流程穩定'
  if (score >= 75) return '良好'
  if (score >= 60) return '需改進：檢視例外交易的模式'
  return '警示：暫停新增衛星部位，直到分數回升'
}

// A stop-loss exit more than 2% below the stop in force: the stop was not
// acted on when it was hit.
export const LATE_STOP = 0.02
export function lateStopExits(plans: Pick<TradePlan, 'id' | 'currentStop' | 'stopLoss'>[], trades: Trade[]): number {
  const byId = new Map(plans.map((p) => [p.id, p]))
  return trades.filter((t) => {
    if (t.side !== 'sell' || t.reason !== 'stop_loss' || !t.planId) return false
    const plan = byId.get(t.planId)
    const stop = plan?.currentStop ?? plan?.stopLoss
    return stop !== undefined && t.price < stop * (1 - LATE_STOP)
  }).length
}

// Each late stop costs 5 points, at most 20 (blueprint 02 §3.8). Coverage
// and slippage are shown on the trade log but not scored, so trades made
// before trade plans existed are not penalised.
const LATE_STOP_PENALTY = 5
const LATE_STOP_MAX_PENALTY = 20

export function computeDiscipline(
  trades: Trade[],
  holdings: Holding[],
  theses: StockThesis[],
  policy: InvestmentPolicy,
  today: string,
  plans: Pick<TradePlan, 'id' | 'currentStop' | 'stopLoss'>[] = [],
): DisciplineReport {
  // Imported trades never ran the checklist: they count neither as rule
  // breaks nor as rule-following trades.
  const checked = trades.filter((t) => t.source !== 'broker')
  const exceptionTrades = checked.filter(isException)
  const complianceRate =
    checked.length > 0 ? ((checked.length - exceptionTrades.length) / checked.length) * 100 : null

  const thesisById = new Map(theses.map((t) => [t.id, t]))
  const satelliteHoldings = holdings.filter((h) => isSatellite(h.sleeve) && h.shares > 0)
  // A position is documented by a complete research card, or by the
  // strategy card it was entered under.
  const completeCount = satelliteHoldings.filter((h) => {
    if (h.strategyId) return true
    const thesis = h.thesisId ? thesisById.get(h.thesisId) : undefined
    return thesis !== undefined && evaluateThesis(thesis, policy).isComplete
  }).length
  const thesisCompletenessRate =
    satelliteHoldings.length > 0 ? (completeCount / satelliteHoldings.length) * 100 : null

  const { due, done } = reviewsDue(trades, today)
  const reviewCompletionRate = due.length + done > 0 ? (done / (due.length + done)) * 100 : null

  // Weighted average over whichever components have data.
  const parts: [number | null, number][] = [
    [complianceRate, WEIGHTS.compliance],
    [thesisCompletenessRate, WEIGHTS.thesis],
    [reviewCompletionRate, WEIGHTS.review],
  ]
  const available = parts.filter((p): p is [number, number] => p[0] !== null)
  const weightSum = available.reduce((acc, [, w]) => acc + w, 0)
  const lateStops = lateStopExits(plans, trades)
  const penalty = Math.min(lateStops * LATE_STOP_PENALTY, LATE_STOP_MAX_PENALTY)
  const score =
    weightSum > 0
      ? Math.max(0, Math.round(available.reduce((acc, [v, w]) => acc + v * w, 0) / weightSum) - penalty)
      : null

  return {
    score,
    tier: tierOf(score),
    complianceRate,
    thesisCompletenessRate,
    reviewCompletionRate,
    exceptionTrades,
    pendingReviews: due,
    lateStops,
  }
}
