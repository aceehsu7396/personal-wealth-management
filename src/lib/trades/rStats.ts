import type { PlanAdvice, Trade, TradePlan } from '../storage/schema'

// What closed trade plans earned in R, grouped by entry method and by the
// regime they were drafted in (blueprint 02 §6.3), and whether following
// the assistant's advice paid (§3.8).

export const MIN_GROUP = 5

export interface ClosedPlanResult {
  plan: TradePlan
  r: number
}

// R = (average exit − fill) ÷ (fill − initial stop), from the plan's sells.
export function closedResults(plans: TradePlan[], trades: Trade[]): ClosedPlanResult[] {
  const out: ClosedPlanResult[] = []
  for (const plan of plans) {
    if (plan.status !== 'closed') continue
    const entry = plan.fillPrice ?? plan.entryPrice
    const risk = entry !== undefined && plan.stopLoss !== undefined ? entry - plan.stopLoss : 0
    const sells = trades.filter((t) => t.planId === plan.id && t.side === 'sell')
    const shares = sells.reduce((a, t) => a + t.shares, 0)
    if (!entry || risk <= 0 || shares === 0) continue
    const exit = sells.reduce((a, t) => a + t.price * t.shares, 0) / shares
    out.push({ plan, r: (exit - entry) / risk })
  }
  return out
}

export interface RGroup {
  key: string
  count: number
  winRate: number
  avgR: number
  // Average R per trade: the expectancy.
  expectancy: number
  enough: boolean
}

export function groupR(results: ClosedPlanResult[], keyOf: (p: TradePlan) => string): RGroup[] {
  const groups = new Map<string, number[]>()
  for (const { plan, r } of results) groups.set(keyOf(plan), [...(groups.get(keyOf(plan)) ?? []), r])
  return [...groups.entries()]
    .map(([key, rs]) => {
      const avg = rs.reduce((a, b) => a + b, 0) / rs.length
      return { key, count: rs.length, winRate: rs.filter((r) => r > 0).length / rs.length, avgR: avg, expectancy: avg, enough: rs.length >= MIN_GROUP }
    })
    .sort((a, b) => b.count - a.count)
}

// The regime name a plan was drafted in, from its snapshot.
export const regimeOfPlan = (p: TradePlan) => p.regimeSnapshot?.split('（')[0] ?? '（未記錄局勢）'

export interface AdviceUptake {
  byLevel: Record<PlanAdvice['level'], { decided: number; accepted: number }>
  // Average R of closed plans that accepted every required item, and of
  // those that declined at least one.
  followedR: number | null
  declinedR: number | null
  followedCount: number
  declinedCount: number
}

export function adviceUptake(plans: TradePlan[], results: ClosedPlanResult[]): AdviceUptake {
  const byLevel = { required: { decided: 0, accepted: 0 }, suggest: { decided: 0, accepted: 0 }, notice: { decided: 0, accepted: 0 } }
  for (const p of plans) {
    for (const a of p.advice) {
      if (!a.decision) continue
      byLevel[a.level].decided++
      if (a.decision === 'accepted') byLevel[a.level].accepted++
    }
  }
  const declined = (p: TradePlan) => p.advice.some((a) => a.level === 'required' && a.decision === 'declined')
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const followed = results.filter((x) => !declined(x.plan)).map((x) => x.r)
  const against = results.filter((x) => declined(x.plan)).map((x) => x.r)
  return { byLevel, followedR: mean(followed), declinedR: mean(against), followedCount: followed.length, declinedCount: against.length }
}
