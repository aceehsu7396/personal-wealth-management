import { describe, expect, it } from 'vitest'
import { planningAssumptions, portfolioValueTwd, snapshotsAsCheckIns, upsertSnapshot } from './netWorth'
import { createDefaultAppData, type Holding } from '../storage/schema'

const assumptions = { ...createDefaultAppData().assumptions, currentNetWorth: 123 }
const holding = (o: Partial<Holding>): Holding => ({
  id: 'h',
  ticker: '0050',
  name: '',
  sleeve: 'core_tw',
  currency: 'TWD',
  shares: 100,
  avgCost: 1,
  currentPrice: 150,
  createdAt: '',
  ...o,
})

describe('planningAssumptions', () => {
  it('uses the manual figure before any holdings exist', () => {
    const p = planningAssumptions(assumptions, [], 30)
    expect(p.fromPortfolio).toBe(false)
    expect(p.assumptions.currentNetWorth).toBe(123)
  })

  it('uses the portfolio value (USD converted) once holdings exist', () => {
    const holdings = [holding({}), holding({ id: 'v', currency: 'USD', shares: 10, currentPrice: 100 })]
    expect(portfolioValueTwd(holdings, 30)).toBe(15000 + 30000)
    const p = planningAssumptions(assumptions, holdings, 30)
    expect(p.fromPortfolio).toBe(true)
    expect(p.assumptions.currentNetWorth).toBe(45000)
  })

  it('ignores holdings that were fully sold', () => {
    expect(planningAssumptions(assumptions, [holding({ shares: 0 })], 30).fromPortfolio).toBe(false)
  })
})

describe('upsertSnapshot', () => {
  it('keeps one entry per month with the latest value, sorted', () => {
    let s = upsertSnapshot([], 100, '2026-09-30')
    s = upsertSnapshot(s, 110, '2026-10-02')
    s = upsertSnapshot(s, 120, '2026-10-11')
    expect(s).toEqual([
      { month: '2026-09', date: '2026-09-30', valueTwd: 100 },
      { month: '2026-10', date: '2026-10-11', valueTwd: 120 },
    ])
    expect(snapshotsAsCheckIns(s)[1]).toMatchObject({ date: '2026-10-11', netWorthAmount: 120 })
  })
})
