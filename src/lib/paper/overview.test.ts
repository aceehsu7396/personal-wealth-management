import { describe, expect, it } from 'vitest'
import type { PaperAccount } from '../storage/schema'
import { placeOrder, updatePrices } from './paperAccount'
import { paperOverview } from './overview'

function account(id: string, cash = 100_000, market: PaperAccount['market'] = 'TW'): PaperAccount {
  return { id, name: `帳戶${id}`, market, initialCash: cash, cash, positions: [], orders: [], equityHistory: [], signalLog: [], createdAt: '' }
}

const buy = (a: PaperAccount, symbol: string, shares: number, price: number, date = '2026-10-01') =>
  placeOrder(a, { symbol, name: symbol, side: 'buy', type: 'market', shares, stopLoss: price * 0.9, reason: '' }, { price, date })
const sell = (a: PaperAccount, symbol: string, shares: number, price: number, date = '2026-10-05') =>
  placeOrder(a, { symbol, name: '', side: 'sell', type: 'market', shares, reason: '' }, { price, date })

describe('paperOverview', () => {
  it('is empty without accounts', () => {
    expect(paperOverview([])).toEqual({ accounts: [], holdings: [], shared: [], totals: [] })
  })

  it('splits cash from holdings and adds unrealized and realized to the total P&L', () => {
    let a = buy(account('a'), 'TW:2330', 20, 1000)
    a = sell(a, 'TW:2330', 10, 1200)
    a = updatePrices(a, { 'TW:2330': { price: 1100, date: '2026-10-06' } })
    const [row] = paperOverview([a]).accounts
    expect(row.holdings).toBeCloseTo(10 * 1100)
    expect(row.cash).toBeCloseTo(a.cash)
    expect(row.equity).toBeCloseTo(a.cash + 11_000)
    expect(row.realized).toBeGreaterThan(0)
    expect(row.unrealized + row.realized).toBeCloseTo(row.pnl, 6)
    expect(row.cashShare).toBeCloseTo(a.cash / row.equity)
  })

  it('sums each market apart and keeps accounts without holdings', () => {
    const a = buy(account('a'), 'TW:0050', 100, 100)
    const b = account('b', 50_000)
    const c = buy(account('c', 10_000, 'US'), 'US:SPY', 10, 500)
    const o = paperOverview([a, b, c])
    expect(o.totals.map((t) => t.market)).toEqual(['TW', 'US'])
    const tw = o.totals[0]
    expect(tw.accounts).toBe(2)
    expect(tw.equity).toBeCloseTo(o.accounts[0].equity + o.accounts[1].equity)
    expect(tw.cash).toBeCloseTo(a.cash + 50_000)
    expect(o.accounts[1]).toMatchObject({ holdings: 0, unrealized: 0, realized: 0, pnl: 0, cashShare: 1 })
    expect(o.totals[1].equity).toBeCloseTo(o.accounts[2].equity)
  })

  it('lists every holding by value and totals symbols held by several accounts', () => {
    const a = buy(buy(account('a'), 'TW:0050', 100, 100), 'TW:2330', 10, 1000)
    const b = buy(account('b'), 'TW:0050', 50, 100)
    const o = paperOverview([a, b])
    expect(o.holdings.map((h) => `${h.accountId}:${h.symbol}`)).toEqual(['a:TW:0050', 'a:TW:2330', 'b:TW:0050'])
    expect(o.shared).toHaveLength(1)
    expect(o.shared[0]).toMatchObject({ symbol: 'TW:0050', accounts: 2, shares: 150, value: 15_000 })
    expect(o.holdings[0].weight).toBeCloseTo(10_000 / o.accounts[0].equity)
  })

  it('sets aside cash for open buy orders', () => {
    let a = buy(account('a'), 'TW:0050', 100, 100)
    a = placeOrder(a, { symbol: 'TW:2330', name: '', side: 'buy', type: 'limit', price: 900, shares: 10, reason: '' })
    a = placeOrder(a, { symbol: 'TW:0050', name: '', side: 'buy', type: 'market', fillAt: 'open', shares: 20, reason: '' })
    const [row] = paperOverview([a]).accounts
    expect(row.pendingBuys).toBeCloseTo(9000 + 20 * 100)
    expect(row.available).toBeCloseTo(a.cash - 11_000)
  })
})
