import { describe, expect, it } from 'vitest'
import {
  annualVol,
  beta,
  concentration,
  correlation,
  drawdownStats,
  horizonReturns,
  onCalendar,
  portfolioReturns,
  returnsByDate,
  riskBudget,
  riskContributions,
  varCvar,
} from './riskMetrics'
import { createDefaultInvestmentPolicy, type TradePlan } from '../storage/schema'

describe('return statistics', () => {
  it('measures volatility, beta and correlation', () => {
    const market = [0.01, -0.02, 0.015, -0.005, 0.02, -0.01]
    const double = market.map((r) => r * 2)
    expect(beta(double, market)).toBeCloseTo(2)
    expect(correlation(double, market)).toBeCloseTo(1)
    expect(annualVol(double)).toBeCloseTo(annualVol(market) * 2)
    expect(beta(market, [0, 0, 0, 0, 0, 0])).toBeNull()
  })

  it('reads VaR and CVaR from the worst 5%', () => {
    const returns = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000)
    const r = varCvar(returns)!
    expect(r.var).toBeCloseTo(0.046)
    expect(r.cvar).toBeCloseTo(0.048)
    expect(varCvar([0.01])).toBeNull()
  })

  it('compounds overlapping horizons and aligns calendars', () => {
    expect(horizonReturns([0.1, 0.1, 0.1], 2)).toEqual([expect.closeTo(0.21), expect.closeTo(0.21)])
    const byDate = returnsByDate([
      { date: 'a', close: 100 },
      { date: 'b', close: 110 },
    ])
    expect(onCalendar(['a', 'b', 'c'], byDate)).toEqual([0, expect.closeTo(0.1), 0])
  })
})

describe('portfolio risk', () => {
  const a = [0.02, -0.01, 0.03, -0.02, 0.01]
  const b = [0.001, -0.001, 0.002, 0, -0.001]

  it('splits variance into contributions that sum to one', () => {
    const rc = riskContributions([0.5, 0.5], [a, b])
    expect(rc[0] + rc[1]).toBeCloseTo(1)
    expect(rc[0]).toBeGreaterThan(0.9)
    expect(portfolioReturns([0.5, 0.5], [a, b])[0]).toBeCloseTo(0.0105)
  })

  it('counts concentration and effective holdings', () => {
    const c = concentration([0.25, 0.25, 0.25, 0.25])
    expect(c.effective).toBeCloseTo(4)
    expect(c.top5).toBeCloseTo(1)
  })

  it('reads drawdowns from snapshots and the peak', () => {
    const d = drawdownStats(
      [
        { month: '2026-01', date: '2026-01-31', valueTwd: 100 },
        { month: '2026-02', date: '2026-02-28', valueTwd: 80 },
        { month: '2026-03', date: '2026-03-31', valueTwd: 95 },
      ],
      90,
      100,
      '2026-01-31',
      '2026-03-31',
    )
    expect(d.worst).toBeCloseTo(-0.2)
    expect(d.current).toBeCloseTo(-0.1)
    expect(d.days).toBe(59)
  })

  it('measures open stop risk against the budget', () => {
    const plan = { status: 'open', market: 'TW', fillPrice: 100, currentStop: 90, shares: 1000 } as TradePlan
    const r = riskBudget([plan], 1_000_000, createDefaultInvestmentPolicy(), 30)
    expect(r.used).toBe(10_000)
    expect(r.budget).toBe(80_000)
    expect(r.ratio).toBeCloseTo(0.125)
  })
})
