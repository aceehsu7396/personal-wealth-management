import { describe, expect, it } from 'vitest'
import { chipSnapshot, condenseFlows, type FlowRow } from './chips'
import { chipSignals } from './signals'
import { runBacktest, marketCosts, type BacktestInput } from '../backtest/engine'
import type { Bar } from '../market/priceHistory'

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i))
    return d.toISOString().slice(0, 10)
  })

describe('condenseFlows', () => {
  it('adds foreign investors and foreign dealers, keeps investment trusts apart', () => {
    const rows = condenseFlows([
      { date: '2026-10-02', name: 'Foreign_Investor', buy: 5000, sell: 2000 },
      { date: '2026-10-02', name: 'Foreign_Dealer_Self', buy: 100, sell: 0 },
      { date: '2026-10-02', name: 'Investment_Trust', buy: 0, sell: 700 },
      { date: '2026-10-02', name: 'Dealer_self', buy: 9999, sell: 0 },
      { date: '2026-10-01', name: 'Foreign_Investor', buy: 0, sell: 1000 },
    ])
    expect(rows).toEqual([
      ['2026-10-01', -1000, 0],
      ['2026-10-02', 3100, -700],
    ])
  })
})

describe('chipSnapshot', () => {
  const dates = days(70)
  // Foreign sells for 60 days, then buys the last 10; trust buys throughout.
  const flows: FlowRow[] = dates.map((d, i) => [d, i < 60 ? -1000 : 3000, 500])
  const snap = chipSnapshot({
    flows,
    margin: dates.map((d, i) => ({ date: d, margin: i < 50 ? 1000 : 1200, short: 60 })),
    ratio: dates.map((d, i) => ({ date: d, ratio: 70 + i * 0.02 })),
    volumes: dates.map(() => 100_000),
  })!

  it('sums net buying in lots and counts the streak', () => {
    expect(snap.foreign5).toBe(15)
    expect(snap.foreign20).toBe(20)
    expect(snap.foreign60).toBe(-20)
    expect(snap.foreignStreak).toBe(10)
    expect(snap.trust20).toBe(10)
    expect(snap.foreign20OfVolume).toBe(1)
  })

  it('tracks ownership, margin and the short/margin ratio', () => {
    expect(snap.foreignRatio).toBeCloseTo(71.38, 2)
    expect(snap.foreignRatioChange60).toBeCloseTo(1.2, 2)
    expect(snap.marginChange20).toBe(20)
    expect(snap.shortMarginRatio).toBe(5)
  })

  it('becomes observed signals: flows and ownership lean, margin stays neutral', () => {
    const s = Object.fromEntries(chipSignals(snap).map((x) => [x.key, x]))
    expect(s.foreign).toMatchObject({ tone: 'bull', group: 'chips' })
    expect(s.foreign.detail).toContain('連續 10 日買超')
    expect(s.trust.tone).toBe('bull')
    expect(s.foreignRatio.tone).toBe('bull')
    expect(s.margin).toMatchObject({ tone: 'neutral', label: '融資 20 日大增 20%' })
  })

  it('needs at least five days of flows', () => {
    expect(chipSnapshot({ flows: flows.slice(0, 3), margin: [], ratio: [], volumes: [] })).toBeNull()
  })
})

describe('chip_flow template', () => {
  const dates = days(40)
  const bars: Bar[] = dates.map((date, i) => ({ date, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 0 }))
  // Foreign buys on days 0–19, sells on days 20–39.
  const chips = Object.fromEntries(dates.map((d, i) => [d, i < 20 ? 1000 : -3000]))
  const input = (o: Partial<BacktestInput> = {}): BacktestInput => ({
    template: 'chip_flow',
    params: { flowDays: 5, trendDays: 0, atrStop: 0 },
    data: { 'TW:2330': bars },
    start: dates[0],
    end: dates[39],
    initialCapital: 1_000_000,
    costs: marketCosts(1, 0),
    sizing: { mode: 'equal', riskPercent: 1 },
    chips: { 'TW:2330': chips },
    ...o,
  })

  it('buys the day after five days of net buying and sells when flows turn negative', () => {
    const r = runBacktest(input())
    expect(r.trades).toHaveLength(1)
    const t = r.trades[0]
    // Signal at the close of day 4, filled at the next open (day 5).
    expect(t.entryDate).toBe(dates[5])
    expect(t.entryPrice).toBe(105)
    // The 5-day sum turns negative on day 21 (4 × 1000 − 3000 > 0 on day 20).
    expect(t.exitDate).toBe(dates[22])
  })

  it('does not trade without chip data', () => {
    expect(runBacktest(input({ chips: undefined })).trades).toHaveLength(0)
  })
})
