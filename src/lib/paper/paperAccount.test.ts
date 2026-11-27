import { describe, expect, it } from 'vitest'
import type { PaperAccount } from '../storage/schema'
import { cancelOrder, equityOf, paperStats, placeOrder, updatePrices } from './paperAccount'
import { latestSignals } from '../backtest/engine'

function account(cash = 100_000): PaperAccount {
  return { id: 'a', name: 'x', market: 'TW', initialCash: cash, cash, positions: [], orders: [], equityHistory: [], signalLog: [], createdAt: '' }
}

const fee = (v: number) => Math.max(20, v * 0.001425)

describe('paper account', () => {
  it('fills a market buy at the quote, net of commission', () => {
    const a = placeOrder(account(), { symbol: 'TW:0050', name: '元大台灣50', side: 'buy', type: 'market', shares: 100, stopLoss: 90, reason: '突破' }, { price: 100, date: '2026-10-01' }, '2026-10-01T15:00:00Z')
    expect(a.cash).toBeCloseTo(100_000 - 10_000 - fee(10_000))
    expect(a.positions[0]).toMatchObject({ shares: 100, stopLoss: 90, openedAt: '2026-10-01' })
    expect(a.positions[0].avgCost).toBeCloseTo(100 + fee(10_000) / 100)
    expect(a.equityHistory).toHaveLength(1)
    expect(() => placeOrder(account(), { symbol: 'TW:0050', name: '', side: 'buy', type: 'market', shares: 2000, reason: '' }, { price: 100, date: '2026-10-01' })).toThrow('現金不足')
  })

  it('sells with tax and records realized P&L and R', () => {
    let a = placeOrder(account(), { symbol: 'TW:2330', name: '', side: 'buy', type: 'market', shares: 10, stopLoss: 900, reason: '' }, { price: 1000, date: '2026-10-01' })
    a = placeOrder(a, { symbol: 'TW:2330', name: '', side: 'sell', type: 'market', shares: 10, reason: '出場' }, { price: 1200, date: '2026-10-05' })
    const sell = a.orders.find((o) => o.side === 'sell')!
    const avg = 1000 + fee(10_000) / 10
    expect(sell.realizedPnl).toBeCloseTo(12_000 - fee(12_000) - 12_000 * 0.003 - avg * 10)
    expect(sell.rMultiple).toBeCloseTo((1200 - avg) / (avg - 900))
    expect(a.positions).toHaveLength(0)
  })

  it('fills limit orders on a later bar when the range reaches the price', () => {
    let a = placeOrder(account(), { symbol: 'TW:0050', name: '', side: 'buy', type: 'limit', price: 95, shares: 100, reason: '' }, undefined, '2026-10-01T15:00:00Z')
    a = updatePrices(a, { 'TW:0050': { price: 99, date: '2026-10-01', low: 94 } })
    expect(a.orders[0].status).toBe('open') // same day as the order
    a = updatePrices(a, { 'TW:0050': { price: 97, date: '2026-10-02', open: 98, low: 96 } })
    expect(a.orders[0].status).toBe('open')
    a = updatePrices(a, { 'TW:0050': { price: 96, date: '2026-10-05', open: 93, low: 92, high: 97 } })
    expect(a.orders[0]).toMatchObject({ status: 'filled', fillPrice: 93 }) // opened below the limit
    expect(cancelOrder(a, a.orders[0].id).orders[0].status).toBe('filled')
  })

  it('triggers the position stop, at the open on a gap down', () => {
    let a = placeOrder(account(), { symbol: 'TW:0050', name: '', side: 'buy', type: 'market', shares: 100, stopLoss: 90, reason: '' }, { price: 100, date: '2026-10-01' })
    a = updatePrices(a, { 'TW:0050': { price: 95, date: '2026-10-02', low: 91 } })
    expect(a.positions).toHaveLength(1)
    a = updatePrices(a, { 'TW:0050': { price: 86, date: '2026-10-03', open: 87, low: 85, high: 88 } })
    expect(a.positions).toHaveLength(0)
    const stop = a.orders.find((o) => o.reason.includes('停損'))!
    expect(stop.fillPrice).toBe(87)
    expect(stop.rMultiple).toBeLessThan(-1)
    expect(a.equityHistory.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(equityOf(a)).toBeCloseTo(a.cash)
  })

  it('summarizes fills, wins and the strategy profit', () => {
    let a = placeOrder(account(), { symbol: 'TW:0050', name: '', side: 'buy', type: 'market', shares: 100, stopLoss: 90, reason: '' }, { price: 100, date: '2026-07-01' })
    a = updatePrices(a, { 'TW:0050': { price: 80, date: '2026-07-02', low: 79 } })
    const s = paperStats(a, '2026-10-12')
    expect(s).toMatchObject({ fills: 2, closed: 1, winRate: 0, months: 3, holdings: 0, unrealized: 0 })
    // The day opened at 80, below the stop at 90: sold at 80, about 2R.
    expect(s.pnl).toBeCloseTo(s.realized)
    expect(s.pnl).toBeLessThan(-2000)
    expect(s.pnl).toBeGreaterThan(-2100)
  })

  it('buys on the pool cash a strategy without money of its own is given', () => {
    const sleeve: PaperAccount = { ...account(0), initialCash: 0 }
    const order = { symbol: 'TW:0050', name: '', side: 'buy' as const, type: 'market' as const, shares: 100, stopLoss: 90, reason: '' }
    expect(() => placeOrder(sleeve, order, { price: 100, date: '2026-10-01' })).toThrow('現金不足')
    const a = placeOrder(sleeve, order, { price: 100, date: '2026-10-01' }, undefined, 50_000)
    expect(a.cash).toBeCloseTo(-10_000 - fee(10_000))
    expect(paperStats(a, '2026-10-01').pnl).toBeCloseTo(-fee(10_000))
    // A limit buy fills on later bars only while the pool has the cash.
    let b = placeOrder(sleeve, { ...order, type: 'limit', price: 95 }, undefined, '2026-10-01T15:00:00Z')
    b = updatePrices(b, { 'TW:0050': { price: 94, date: '2026-10-02', low: 93 } }, 5000)
    expect(b.orders[0].status).toBe('cancelled')
  })
})

describe('latestSignals', () => {
  const bars = (closes: number[]) =>
    closes.map((c, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1 }))

  it('suggests an entry with an ATR stop on a fresh crossover', () => {
    const closes = [10, 9, 8, 7, 6, 8, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 10, 9, 8, 7, 12]
    const out = latestSignals('ma_cross', { fast: 2, slow: 4, atrStop: 2 }, { 'TW:0050': bars(closes) }, {}, 100_000)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ side: 'buy', symbol: 'TW:0050', close: 12 })
    expect(out[0].stopLoss).toBeLessThan(12)
    expect(out[0].shares).toBe(Math.floor(100_000 / 12))
  })

  it('suggests rotating out of a laggard', () => {
    const up = bars(Array.from({ length: 30 }, (_, i) => 100 + i))
    const down = bars(Array.from({ length: 30 }, (_, i) => 100 - i))
    const out = latestSignals('momentum_rotation', { lookbackMonths: 1, topK: 1, absoluteFilter: 1 }, { 'TW:A': up, 'TW:B': down }, { 'TW:B': { shares: 5, openedAt: '2026-01-01' } }, 10_000)
    expect(out.map((o) => `${o.side}:${o.symbol}`)).toEqual(['sell:TW:B', 'buy:TW:A'])
  })
})

describe('next-open orders (weekly cards)', () => {
  it('waits for the next bar and fills at its open', () => {
    let a = placeOrder(account(), { symbol: 'TW:0050', name: '', side: 'buy', type: 'market', fillAt: 'open', shares: 100, stopLoss: 90, reason: '策略訊號' }, undefined, '2026-11-21T02:00:00Z')
    expect(a.orders[0].status).toBe('open')
    expect(a.cash).toBe(100_000)
    a = updatePrices(a, { 'TW:0050': { price: 104, date: '2026-11-23', open: 101, low: 100, high: 105 } })
    expect(a.orders[0]).toMatchObject({ status: 'filled', fillPrice: 101 })
    expect(a.positions[0]).toMatchObject({ shares: 100, stopLoss: 90, openedAt: '2026-11-23' })
  })

  it('cancels a buy whose stop the open already broke', () => {
    let a = placeOrder(account(), { symbol: 'TW:0050', name: '', side: 'buy', type: 'market', fillAt: 'open', shares: 100, stopLoss: 90, reason: '' }, undefined, '2026-11-21T02:00:00Z')
    a = updatePrices(a, { 'TW:0050': { price: 88, date: '2026-11-23', open: 89 } })
    expect(a.orders[0].status).toBe('cancelled')
    expect(a.positions).toHaveLength(0)
  })
})

describe('latest closes', () => {
  it('keeps every quote, held or not, and never an older one', () => {
    let a = updatePrices(account(), { 'TW:2330': { price: 1000, date: '2026-11-18' }, 'TW:0050': { price: 95, date: '2026-11-18' } })
    expect(a.quotes).toEqual({ 'TW:2330': { price: 1000, date: '2026-11-18' }, 'TW:0050': { price: 95, date: '2026-11-18' } })
    a = updatePrices(a, { 'TW:2330': { price: 990, date: '2026-11-17' } })
    expect(a.quotes?.['TW:2330'].price).toBe(1000)
  })
})
