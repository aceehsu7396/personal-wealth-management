import { describe, expect, it } from 'vitest'
import type { Bar } from '../market/priceHistory'
import { runBacktest, symbolStatus, type BacktestInput } from './engine'
import { cadenceOf, decisionDateOf, isDecisionBar, weeklyBars } from './weekly'

// Consecutive weekdays from 2024-01-01 (a Monday), skipping `holidays`.
function weekdays(n: number, holidays: string[] = []): string[] {
  const out: string[] = []
  const d = new Date('2024-01-01T00:00:00Z')
  while (out.length < n) {
    const iso = d.toISOString().slice(0, 10)
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6 && !holidays.includes(iso)) out.push(iso)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

function bars(closes: number[], holidays: string[] = []): Bar[] {
  const dates = weekdays(closes.length, holidays)
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]
    return { date: dates[i], open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1000 }
  })
}

const free = { feeRate: () => 0, minFee: () => 0, taxRate: () => 0 }
const input = (overrides: Partial<BacktestInput>): BacktestInput => ({
  template: 'buy_hold',
  params: {},
  data: {},
  start: '2000-01-01',
  end: '2100-01-01',
  initialCapital: 100_000,
  costs: free,
  sizing: { mode: 'equal', riskPercent: 1 },
  ...overrides,
})
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()

describe('decision days', () => {
  it('names each week by its decision date', () => {
    expect(decisionDateOf('2024-01-01', 5)).toBe('2024-01-05')
    expect(decisionDateOf('2024-01-05', 5)).toBe('2024-01-05')
    // Wednesday decides: Thursday belongs to the next week.
    expect(decisionDateOf('2024-01-04', 3)).toBe('2024-01-10')
    // Across the year end.
    expect(decisionDateOf('2024-12-30', 5)).toBe('2025-01-03')
  })

  it('uses the last session before a holiday on the decision day', () => {
    // Friday 2024-01-05 closed: Thursday decides.
    expect(isDecisionBar('2024-01-04', '2024-01-08', 5)).toBe(true)
    expect(isDecisionBar('2024-01-03', '2024-01-04', 5)).toBe(false)
    // Live: the latest bar decides on the day, or once the day has passed.
    expect(isDecisionBar('2024-01-05', undefined, 5, '2024-01-05')).toBe(true)
    expect(isDecisionBar('2024-01-04', undefined, 5, '2024-01-04')).toBe(false)
    expect(isDecisionBar('2024-01-04', undefined, 5, '2024-01-06')).toBe(true)
  })

  it('builds weekly bars up to the decision day, keeping a week in progress', () => {
    const w = weeklyBars(bars([1, 2, 3, 4, 5, 6, 7, 8]), 5)
    expect(w.bars.map((b) => b.close)).toEqual([5, 8])
    expect(w.bars[0]).toMatchObject({ date: '2024-01-05', open: 1, high: 5, low: 1 })
    expect(w.decision).toEqual([false, false, false, false, true, false, false, false])
    expect(w.weekOf).toEqual([0, 0, 0, 0, 0, 1, 1, 1])
  })

  it('keeps the weekly templates weekly and others as set', () => {
    expect(cadenceOf('weekly_ma')).toBe('weekly')
    expect(cadenceOf('ma_cross')).toBe('daily')
    expect(cadenceOf('ma_cross', 'weekly')).toBe('weekly')
    expect(cadenceOf('buy_hold', 'weekly')).toBe('daily')
  })
})

describe('weekly backtests', () => {
  // Flat, then a steady climb: the daily trend signal fires mid-week.
  const closes = [...Array(30).fill(100), ...Array.from({ length: 40 }, (_, i) => 101 + i)]

  it('decides a daily template only on decision days and fills at the next open', () => {
    const data = { 'TW:A': bars(closes) }
    const daily = runBacktest(input({ template: 'ma_cross', params: { fast: 3, slow: 10, atrStop: 0 }, data }))
    const weekly = runBacktest(input({ template: 'ma_cross', params: { fast: 3, slow: 10, atrStop: 0 }, data, cadence: 'weekly' }))
    const firstDaily = daily.trades[0].entryDate
    const firstWeekly = weekly.trades[0].entryDate
    expect(firstWeekly >= firstDaily).toBe(true)
    // The decision bar is a Friday, so the fill is the Monday after.
    expect(weekday(firstWeekly)).toBe(1)
  })

  it('still stops out mid-week', () => {
    const path = [...Array(30).fill(100), ...Array.from({ length: 12 }, (_, i) => 101 + i * 2), 60, 60, 60, 60, 60, 60]
    const r = runBacktest(input({ template: 'ma_cross', params: { fast: 3, slow: 10, atrStop: 2 }, data: { 'TW:A': bars(path) }, cadence: 'weekly' }))
    const stopped = r.trades.find((t) => t.exitReason === 'stop')
    expect(stopped).toBeDefined()
    expect(weekday(stopped!.exitDate)).not.toBe(1)
  })

  it('runs the weekly templates on weekly closes', () => {
    const path = [...Array(60).fill(100), ...Array.from({ length: 100 }, (_, i) => 100 + i)]
    const data = { 'TW:A': bars(path) }
    const ma = runBacktest(input({ template: 'weekly_ma', params: { fastWeeks: 2, slowWeeks: 5, atrStop: 0 }, data }))
    expect(ma.trades.length).toBeGreaterThan(0)
    expect(weekday(ma.trades[0].entryDate)).toBe(1)
    const breakout = runBacktest(input({ template: 'weekly_breakout', params: { entryWeeks: 4, exitWeeks: 2, atrStop: 0 }, data }))
    expect(breakout.trades.length).toBeGreaterThan(0)
  })

  it('exits a weekly pullback after the longest hold', () => {
    // Rising trend with a dip every few weeks.
    const path = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5 - (i % 25 >= 15 && i % 25 < 20 ? 8 : 0))
    const r = runBacktest(input({ template: 'weekly_pullback', params: { trendWeeks: 10, rsiWeeks: 2, entryBelow: 40, exitAbove: 99, maxHoldWeeks: 2, atrStop: 0 }, data: { 'TW:A': bars(path) } }))
    expect(r.trades.length).toBeGreaterThan(0)
    for (const t of r.trades.filter((x) => x.exitReason === 'signal')) {
      expect((Date.parse(t.exitDate) - Date.parse(t.entryDate)) / 86400000).toBeLessThanOrEqual(14)
    }
  })

  it('rotates weekly into the stronger symbol', () => {
    const up = bars(Array.from({ length: 80 }, (_, i) => 100 + i))
    const down = bars(Array.from({ length: 80 }, (_, i) => 200 - i))
    const r = runBacktest(input({ template: 'weekly_rotation', params: { lookbackWeeks: 4, topK: 1, absoluteFilter: 1 }, data: { 'TW:U': up, 'TW:D': down } }))
    expect(r.trades.every((t) => t.symbol === 'TW:U')).toBe(true)
    expect(r.trades.length).toBeGreaterThan(0)
  })
})

describe('weekly live status', () => {
  const path = [...Array(30).fill(100), ...Array.from({ length: 13 }, (_, i) => 101 + i)]

  it('waits for the decision day before entering', () => {
    const data = { 'TW:A': bars(path) }
    const last = data['TW:A'].at(-1)!.date
    const params = { fast: 1, slow: 40, atrStop: 2 }
    // Daily: the cross is today, enter.
    const daily = symbolStatus('ma_cross', { ...params, slow: 35 }, data, {})
    expect(['enter', 'wait']).toContain(daily[0].state)
    const st = symbolStatus('ma_cross', { fast: 1, slow: 2, atrStop: 2 }, data, {}, undefined, { cadence: 'weekly', decisionDay: 5, today: last })
    expect(weekday(last)).not.toBe(5)
    expect(st[0].state).not.toBe('enter')
    expect(st[0].decidesOn).toBe(decisionDateOf(last, 5))
    // With today's weekday as the decision day, it decides now.
    const now = symbolStatus('ma_cross', { fast: 1, slow: 2, atrStop: 2 }, data, {}, undefined, { cadence: 'weekly', decisionDay: weekday(last), today: last })
    expect(now[0].decidesOn).toBeUndefined()
  })
})
