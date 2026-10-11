import type { FireAssumptions, Holding, NetWorthCheckIn, PortfolioSnapshot } from '../storage/schema'
import { holdingValueTwd } from './portfolioRisk'

// The portfolio is the single source of truth for net worth: once there are
// holdings, the FIRE inputs and the overview use their total market value.

export function hasPortfolio(holdings: Holding[]): boolean {
  return holdings.some((h) => h.shares > 0)
}

export function portfolioValueTwd(holdings: Holding[], fxUsdTwd: number): number {
  return holdings.reduce((sum, h) => sum + holdingValueTwd(h, fxUsdTwd), 0)
}

export interface PlanningAssumptions {
  assumptions: FireAssumptions
  // True when currentNetWorth comes from the portfolio rather than manual input.
  fromPortfolio: boolean
  portfolioValueTwd: number
}

export function planningAssumptions(
  assumptions: FireAssumptions,
  holdings: Holding[],
  fxUsdTwd: number,
): PlanningAssumptions {
  const value = portfolioValueTwd(holdings, fxUsdTwd)
  if (!hasPortfolio(holdings)) return { assumptions, fromPortfolio: false, portfolioValueTwd: value }
  return { assumptions: { ...assumptions, currentNetWorth: value }, fromPortfolio: true, portfolioValueTwd: value }
}

// Keeps one snapshot per month: the latest value recorded in that month.
export function upsertSnapshot(
  snapshots: PortfolioSnapshot[],
  valueTwd: number,
  date: string,
): PortfolioSnapshot[] {
  const month = date.slice(0, 7)
  const rest = snapshots.filter((s) => s.month !== month)
  return [...rest, { month, date, valueTwd }].sort((a, b) => a.month.localeCompare(b.month))
}

// Shape expected by the actual-vs-projected chart.
export function snapshotsAsCheckIns(snapshots: PortfolioSnapshot[]): NetWorthCheckIn[] {
  return snapshots.map((s) => ({
    id: s.month,
    date: s.date,
    netWorthAmount: s.valueTwd,
    note: '投資組合市值（自動記錄）',
    createdAt: s.date,
  }))
}
