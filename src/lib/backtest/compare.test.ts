import { describe, expect, it } from 'vitest'
import type { Bar } from '../market/priceHistory'
import type { BacktestStats } from '../storage/schema'
import { DEFAULT_COMPARE_SET, priorTrialsFor, runComparison, summarizeComparison, toSavedRows, type CompareRow } from './compare'

function weekdays(n: number, from = '2020-01-01'): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// A rising path with a deep fall in the middle, so trend rules trade.
function bars(n: number): Bar[] {
  const dates = weekdays(n)
  let p = 100
  return dates.map((date, i) => {
    const prev = p
    p *= 1 + (i > n * 0.45 && i < n * 0.6 ? -0.004 : 0.0015) + 0.01 * Math.sin(i / 7)
    return { date, open: prev, high: Math.max(prev, p) * 1.005, low: Math.min(prev, p) * 0.995, close: p, volume: 1000 }
  })
}

const free = { feeRate: () => 0, minFee: () => 0, taxRate: () => 0 }
const data = { 'TW:2330': bars(1300) }
const base = { data, start: data['TW:2330'][300].date, end: data['TW:2330'][1299].date, initialCapital: 1_000_000, costs: free, sizing: { mode: 'equal' as const, riskPercent: 1 } }

describe('DEFAULT_COMPARE_SET', () => {
  it('holds the confirmed five signal templates and two benchmarks', () => {
    expect(DEFAULT_COMPARE_SET.filter((e) => e.role === 'signal').map((e) => e.key)).toEqual(['ma_cross', 'ma_200', 'donchian', 'rsi_reversion', 'chip_flow'])
    expect(DEFAULT_COMPARE_SET.filter((e) => e.role === 'benchmark').map((e) => e.template)).toEqual(['buy_hold', 'dca'])
    expect(DEFAULT_COMPARE_SET.find((e) => e.key === 'ma_200')?.params).toEqual({ fast: 1, slow: 200, atrStop: 0 })
    expect(DEFAULT_COMPARE_SET.find((e) => e.key === 'ma_cross')?.params).toEqual({ fast: 20, slow: 120, atrStop: 3 })
  })
})

describe('runComparison', () => {
  it('runs every entry on the same dates and judges signals against buy-and-hold', () => {
    const out = runComparison({ entries: DEFAULT_COMPARE_SET, base, oosFraction: 0.3, maxDrawdownLimitPercent: 30 })
    expect(out.rows).toHaveLength(7)
    expect(out.trials).toBe(5)
    // No chip data: that row is skipped with a reason, the rest still run.
    const chip = out.rows.find((r) => r.entry.key === 'chip_flow')!
    expect(chip.stats).toBeNull()
    expect(chip.error).toBeTruthy()
    for (const r of out.rows.filter((r) => r.entry.key !== 'chip_flow')) expect(r.stats?.full).toBeTruthy()
    for (const r of out.rows.filter((r) => r.entry.role === 'benchmark')) expect(r.verdict).toBeNull()
    expect(out.rows.find((r) => r.entry.key === 'ma_cross')?.verdict).not.toBeNull()
    expect(out.equity[0].values).toHaveLength(7)
    expect(out.oosStart).not.toBeNull()
  })

  it('counts earlier tries on the same stock', () => {
    const out = runComparison({ entries: DEFAULT_COMPARE_SET.slice(0, 2), base, oosFraction: 0.3, maxDrawdownLimitPercent: 30, priorTrials: 5 })
    expect(out.trials).toBe(7)
  })
})

describe('summarizeComparison', () => {
  const stats = (cagr: number, maxDrawdown: number, trades = 30): BacktestStats => ({ totalReturn: cagr, cagr, maxDrawdown, sharpe: 1, trades, winRate: 0.5, profitFactor: 1.5, exposure: 0.6 })
  const row = (key: string, passed: boolean, oos: BacktestStats, trades = 30): CompareRow => ({
    entry: { key, label: key, template: 'ma_cross', params: {}, role: 'signal' },
    stats: { full: { ...oos, trades }, inSample: stats(0.2, -0.2), outOfSample: oos },
    verdict: { passed, route: passed ? 'risk' : null, reason: '' },
    findings: [],
    costSensitive: false,
    deflatedProbability: 0.99,
    avgR: null,
  })

  it('ranks passed rows first, then by Calmar ratio', () => {
    const s = summarizeComparison([row('a', false, stats(0.3, -0.1)), row('b', true, stats(0.1, -0.2)), row('c', true, stats(0.1, -0.1))])
    expect(s.kind).toBe('edge')
    expect(s.ranking).toEqual(['c', 'b', 'a'])
    expect(s.details.some((d) => d.includes('落差最大'))).toBe(true)
  })

  it('flags too few trades and the no-edge case', () => {
    expect(summarizeComparison([row('a', true, stats(0.1, -0.1), 5)]).kind).toBe('few_trades')
    expect(summarizeComparison([row('a', false, stats(0.1, -0.1))]).kind).toBe('none')
  })
})

describe('toSavedRows', () => {
  it('keeps JSON-safe values and counts earlier signal tries', () => {
    const out = runComparison({ entries: DEFAULT_COMPARE_SET, base, oosFraction: 0.3, maxDrawdownLimitPercent: 30 })
    const saved = toSavedRows(out)
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved)
    expect(saved.equity[0].values[4]).toBeNull()
    expect(saved.rows.find((r) => r.entry.key === 'chip_flow')?.error).toBeTruthy()
    expect(priorTrialsFor('TW:2330', [{ symbol: 'TW:2330', ...saved }, { symbol: 'TW:2317', ...saved }])).toBe(4)
  })
})
