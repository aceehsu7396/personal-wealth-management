import { describe, expect, it } from 'vitest'
import type { PaperAccount, PaperFunds } from '../storage/schema'
import { placeOrder, updatePrices } from './paperAccount'
import { paperOverview } from './overview'
import { poolHistory, poolOf } from './fund'

// Strategies without money of their own, drawing on the pool.
function strategy(id: string, market: PaperAccount['market'] = 'TW'): PaperAccount {
  return { id, name: `策略${id}`, market, initialCash: 0, cash: 0, positions: [], orders: [], equityHistory: [], signalLog: [], createdAt: '' }
}
const funds: PaperFunds = { TW: { capital: 1_000_000 }, US: { capital: 20_000 } }
const POWER = 1e9

const buy = (a: PaperAccount, symbol: string, shares: number, price: number, date = '2026-10-01') =>
  placeOrder(a, { symbol, name: symbol, side: 'buy', type: 'market', shares, stopLoss: price * 0.9, reason: '' }, { price, date }, undefined, POWER)
const sell = (a: PaperAccount, symbol: string, shares: number, price: number, date = '2026-10-05') =>
  placeOrder(a, { symbol, name: '', side: 'sell', type: 'market', shares, reason: '' }, { price, date }, undefined, POWER)

describe('cash pool', () => {
  it('is the capital plus what every strategy moved', () => {
    const a = buy(strategy('a'), 'TW:0050', 1000, 100)
    const b = buy(strategy('b'), 'TW:2330', 100, 1000)
    const pool = poolOf([a, b], 'TW', funds)
    expect(pool.cash).toBeCloseTo(1_000_000 + a.cash + b.cash)
    expect(pool.holdings).toBeCloseTo(200_000)
    expect(pool.equity).toBeCloseTo(pool.cash + 200_000)
    expect(pool.pnl).toBeCloseTo(a.cash + b.cash + 200_000)
    expect(pool.openRisk).toBeCloseTo(1000 * 10 + 100 * 100)
  })

  it('keeps accounts with money of their own working as before', () => {
    const legacy: PaperAccount = { ...strategy('x'), initialCash: 100_000, cash: 100_000 }
    expect(poolOf([legacy], 'TW')).toMatchObject({ capital: 100_000, cash: 100_000, equity: 100_000, pnl: 0 })
  })

  it('draws the equity curve from capital and each strategy’s profit', () => {
    let a = buy(strategy('a'), 'TW:0050', 1000, 100, '2026-10-01')
    a = updatePrices(a, { 'TW:0050': { price: 110, date: '2026-10-02' } })
    let b = buy(strategy('b'), 'TW:2330', 10, 1000, '2026-10-02')
    b = updatePrices(b, { 'TW:2330': { price: 900, date: '2026-10-03' } })
    const h = poolHistory([a, b], 'TW', funds)
    expect(h.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    // On 10-03 strategy a has no new point: its 10-02 profit carries.
    expect(h[2].equity).toBeCloseTo(1_000_000 + a.equityHistory[1].equity + b.equityHistory[1].equity)
    expect(h[0].equity).toBeCloseTo(1_000_000 + a.equityHistory[0].equity)
  })
})

describe('paperOverview', () => {
  it('is empty without strategies or funds', () => {
    expect(paperOverview([])).toEqual({ strategies: [], holdings: [], shared: [], totals: [] })
  })

  it('shows a pool with no strategy yet', () => {
    const o = paperOverview([], { TW: { capital: 500_000 } })
    expect(o.totals).toHaveLength(1)
    expect(o.totals[0]).toMatchObject({ market: 'TW', capital: 500_000, cash: 500_000, strategies: 0, cashShare: 1 })
  })

  it('adds each strategy’s unrealized and realized profit', () => {
    let a = buy(strategy('a'), 'TW:2330', 20, 1000)
    a = sell(a, 'TW:2330', 10, 1200)
    a = updatePrices(a, { 'TW:2330': { price: 1100, date: '2026-10-06' } }, POWER)
    const o = paperOverview([a], funds)
    const [row] = o.strategies
    expect(row.holdings).toBeCloseTo(10 * 1100)
    expect(row.realized).toBeGreaterThan(0)
    expect(row.unrealized + row.realized).toBeCloseTo(row.pnl, 6)
    expect(row.pnlShare).toBeCloseTo(row.pnl / 1_000_000)
    expect(o.totals[0].pnl).toBeCloseTo(row.pnl)
    expect(o.totals[0].totalReturn).toBeCloseTo(row.pnl / 1_000_000)
  })

  it('sums each market apart', () => {
    const a = buy(strategy('a'), 'TW:0050', 100, 100)
    const b = strategy('b')
    const c = buy(strategy('c', 'US'), 'US:SPY', 10, 500)
    const o = paperOverview([a, b, c], funds)
    expect(o.totals.map((t) => t.market)).toEqual(['TW', 'US'])
    expect(o.totals[0].strategies).toBe(2)
    expect(o.totals[0].cash).toBeCloseTo(1_000_000 + a.cash)
    expect(o.totals[1].holdings).toBeCloseTo(5000)
    expect(o.strategies[1]).toMatchObject({ holdings: 0, unrealized: 0, realized: 0, pnl: 0 })
  })

  it('lists every holding with its strategy, weighed on the pool', () => {
    const a = buy(buy(strategy('a'), 'TW:0050', 100, 100), 'TW:2330', 10, 1000)
    const b = buy(strategy('b'), 'TW:0050', 50, 100)
    const o = paperOverview([a, b], funds)
    expect(o.holdings.map((h) => `${h.accountId}:${h.symbol}`)).toEqual(['a:TW:0050', 'a:TW:2330', 'b:TW:0050'])
    expect(o.holdings[0]).toMatchObject({ accountName: '策略a', stopLoss: 90 })
    expect(o.holdings[0].weight).toBeCloseTo(10_000 / o.totals[0].equity)
    expect(o.shared[0]).toMatchObject({ symbol: 'TW:0050', accounts: 2, shares: 150, value: 15_000 })
  })

  it('sets aside pool cash for open buy orders', () => {
    let a = buy(strategy('a'), 'TW:0050', 100, 100)
    a = placeOrder(a, { symbol: 'TW:2330', name: '', side: 'buy', type: 'limit', price: 900, shares: 10, reason: '' })
    a = placeOrder(a, { symbol: 'TW:0050', name: '', side: 'buy', type: 'market', fillAt: 'open', shares: 20, reason: '' })
    const t = paperOverview([a], funds).totals[0]
    expect(t.pendingBuys).toBeCloseTo(9000 + 20 * 100)
    expect(t.available).toBeCloseTo(t.cash - 11_000)
  })
})
