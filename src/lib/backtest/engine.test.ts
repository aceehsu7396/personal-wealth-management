import { describe, expect, it } from 'vitest'
import type { Bar } from '../market/priceHistory'
import {
  computeStats,
  coreTradingMix,
  marketCosts,
  runBacktest,
  sensitivityGrid,
  splitStats,
  weeklySample,
  type BacktestInput,
  type BacktestResult,
} from './engine'

// Consecutive weekdays from 2024-01-01 (a Monday).
function weekdays(n: number, from = '2024-01-01'): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Bars from a close path; each open is the previous close (no gaps) unless
// given, high/low bracket open and close.
function bars(closes: number[], opens?: number[], from?: string): Bar[] {
  const dates = weekdays(closes.length, from)
  return closes.map((close, i) => {
    const open = opens?.[i] ?? (i === 0 ? close : closes[i - 1])
    return { date: dates[i], open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1000 }
  })
}

const free = { feeRate: () => 0, minFee: () => 0, taxRate: () => 0 }

function input(overrides: Partial<BacktestInput>): BacktestInput {
  return {
    template: 'buy_hold',
    params: {},
    data: {},
    start: '2000-01-01',
    end: '2100-01-01',
    initialCapital: 100_000,
    costs: free,
    sizing: { mode: 'equal', riskPercent: 1 },
    ...overrides,
  }
}

describe('runBacktest', () => {
  it('buys at the first open and tracks a time-weighted index', () => {
    const r = runBacktest(input({ data: { 'TW:0050': bars([100, 110, 121]) } }))
    expect(r.trades[0]).toMatchObject({ entryPrice: 100, exitPrice: 121, shares: 1000, exitReason: 'end' })
    expect(r.index.map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 1.1, 1.21])
  })

  it('acts on a crossover at the next open, never on the same close', () => {
    // Falling then rising: the 2-day average crosses above the 4-day one.
    const closes = [10, 9, 8, 7, 6, 8, 10, 12, 14, 16]
    const opens = closes.map((c, i) => (i === 0 ? c : closes[i - 1] + 0.5))
    const data = { 'TW:2330': bars(closes, opens) }
    const r = runBacktest(input({ template: 'ma_cross', params: { fast: 2, slow: 4, atrStop: 0 }, data }))
    const crossDay = 6 // fast (9) > slow (8) for the first time at this close
    expect(r.trades[0].entryDate).toBe(data['TW:2330'][crossDay + 1].date)
    expect(r.trades[0].entryPrice).toBe(opens[crossDay + 1])
  })

  it('charges Taiwan commission and transaction tax', () => {
    const costs = marketCosts(1)
    const r = runBacktest(input({ costs, data: { 'TW:2330': bars([100, 100]) } }))
    const t = r.trades[0]
    const shares = Math.floor(100_000 / (100 * 1.001425))
    expect(t.shares).toBe(shares)
    const value = shares * 100
    const expected = value - value * 0.001425 - value * 0.003 - (value + value * 0.001425)
    expect(t.pnl).toBeCloseTo(expected, 6)
    // ETFs pay 0.1% tax instead of 0.3%.
    const etf = runBacktest(input({ costs, data: { 'TW:0050': bars([100, 100]) } })).trades[0]
    expect(etf.pnl).toBeGreaterThan(t.pnl)
    // US symbols: commission as entered, no tax, no minimum.
    expect(marketCosts(1, 0.1).feeRate('US:SPY')).toBe(0.001)
    expect(marketCosts(1, 0.1).minFee('US:SPY')).toBe(0)
  })

  // 20 flat bars with a 1-point range (ATR ≈ 1), then a breakout to 12.
  function breakout(after: number[], afterOpens?: number[]): Record<string, Bar[]> {
    const warm = Array.from({ length: 20 }, () => 10)
    const closes = [...warm, 12, 12, ...after]
    const opens = [...warm, 10, 12, ...(afterOpens ?? after.map((_, i) => (i === 0 ? 12 : after[i - 1])))]
    const b = bars(closes, opens).map((x, i) => (i < 20 ? { ...x, high: 10.5, low: 9.5 } : x))
    return { 'TW:2330': b }
  }

  it('exits at the stop, or at the open when the price gaps below it', () => {
    const data = breakout([12, 8], [12, 7])
    const r = runBacktest(
      input({ template: 'donchian', params: { entryDays: 3, exitDays: 3, atrStop: 1 }, data }),
    )
    const t = r.trades[0]
    expect(t.entryPrice).toBe(12)
    expect(t.exitReason).toBe('stop')
    expect(t.exitPrice).toBe(7) // gapped below the stop: filled at the open
    expect(t.rMultiple).toBeLessThan(-1)
  })

  it('sizes by risk: loss at the stop ≈ risk % of equity', () => {
    const data = breakout([12, 12])
    const r = runBacktest(
      input({ template: 'donchian', params: { entryDays: 3, exitDays: 3, atrStop: 2 }, data, sizing: { mode: 'risk', riskPercent: 1 } }),
    )
    const t = r.trades[0]
    // 1% of 100k ÷ (2 × ATR ≈ 2.1) ≈ 470 shares, far below a full slot.
    expect(t.shares).toBeGreaterThan(400)
    expect(t.shares).toBeLessThan(520)
  })

  it('rotates into the strongest symbol and holds cash when all fall', () => {
    const n = 70
    const up = bars(Array.from({ length: n }, (_, i) => 100 + i))
    const down = bars(Array.from({ length: n }, (_, i) => 100 - i * 0.5))
    const r = runBacktest(
      input({ template: 'momentum_rotation', params: { lookbackMonths: 1, topK: 1, absoluteFilter: 1 }, data: { 'TW:A': up, 'TW:B': down } }),
    )
    expect(new Set(r.trades.map((t) => t.symbol))).toEqual(new Set(['TW:A']))

    const bothDown = runBacktest(
      input({ template: 'momentum_rotation', params: { lookbackMonths: 1, topK: 1, absoluteFilter: 1 }, data: { 'TW:B': down } }),
    )
    expect(bothDown.trades).toHaveLength(0)
  })

  it('buys RSI dips only above the long-term average', () => {
    const closes = [...Array.from({ length: 30 }, (_, i) => 100 + i), 127, 125, 124, 130, 135, 140, 145]
    const r = runBacktest(
      input({
        template: 'rsi_reversion',
        params: { rsiDays: 3, trendDays: 20, entryBelow: 30, exitAbove: 60, maxHoldDays: 10, atrStop: 0 },
        data: { 'TW:2330': bars(closes) },
      }),
    )
    expect(r.trades.length).toBeGreaterThan(0)
    expect(r.trades[0].exitReason).toBe('signal')
  })

  it('adds DCA contributions as flows without counting them as return', () => {
    const closes = Array.from({ length: 70 }, () => 100)
    const r = runBacktest(input({ template: 'dca', params: { monthlyAmount: 10_000 }, data: { 'TW:0050': bars(closes) } }))
    expect(r.flows.filter((f) => f > 0)).toHaveLength(4) // Jan–Apr 2024
    expect(r.equity[r.equity.length - 1]).toBeCloseTo(40_000, 0)
    expect(r.index[r.index.length - 1]).toBeCloseTo(1, 6)
  })
})

function series(index: number[], from = '2024-01-01'): BacktestResult {
  const dates = weekdays(index.length, from)
  return { dates, equity: index, flows: [], index, invested: index.map(() => true), trades: [] }
}

describe('statistics', () => {
  it('computes return, CAGR and drawdown', () => {
    const r = series([1, 1.2, 0.9, 1.1])
    const s = computeStats(r, 0, 3)
    expect(s.totalReturn).toBeCloseTo(0.1)
    expect(s.maxDrawdown).toBeCloseTo(0.9 / 1.2 - 1)
    expect(s.exposure).toBe(1)
  })

  it('splits off the last 30% as out-of-sample', () => {
    const r = series(Array.from({ length: 101 }, (_, i) => 1 + i / 100))
    const s = splitStats(r, 0.3)
    expect(s.splitIndex).toBe(70)
    expect(s.inSample!.totalReturn).toBeCloseTo(0.7)
    expect(s.outOfSample!.totalReturn).toBeCloseTo(2 / 1.7 - 1)
    expect(splitStats(r, 0).outOfSample).toBeNull()
  })

  it('mixes core and strategy with yearly rebalancing', () => {
    const n = 300
    const strategy = series(Array.from({ length: n }, (_, i) => 1 + i * 0.002))
    const core = series(Array.from({ length: n }, (_, i) => 1 + i * 0.001))
    const rows = coreTradingMix(strategy, core, 0.5)
    expect(rows.map((r) => r.coreWeight)).toEqual([0, 0.5, 1])
    expect(rows[0].cagr).toBeCloseTo(computeStats(strategy, 0, n - 1).cagr, 6)
    expect(rows[2].cagr).toBeCloseTo(computeStats(core, 0, n - 1).cagr, 6)
    expect(rows[1].cagr).toBeGreaterThan(rows[2].cagr)
  })

  it('samples the last trading day of each week', () => {
    const dates = weekdays(10)
    const out = weeklySample(dates, dates.map((_, i) => i))
    expect(out.map((p) => p.date)).toEqual(['2024-01-05', '2024-01-12'])
  })

  it('varies two parameters around the chosen values', () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + 10 * Math.sin(i / 10) + i * 0.1)
    const grid = sensitivityGrid(
      input({ template: 'ma_cross', params: { fast: 20, slow: 60, atrStop: 0 }, data: { 'TW:0050': bars(closes) } }),
      0.3,
    )!
    expect(grid.aValues).toEqual([15, 20, 25])
    expect(grid.bValues).toEqual([45, 60, 75])
    expect(grid.cells).toHaveLength(9)
  })
})
