import { describe, expect, it } from 'vitest'
import type { Bar } from '../market/priceHistory'
import { symbolStatus, type DecisionTiming } from './engine'
import { rsi, rsiPrice, rsiState } from './indicators'
import type { StrategyTemplate } from '../storage/schema'

// The entry and exit prices the assistant shows are checked against the
// engine itself: a close just past the price must flip the signal, a close
// just short of it must not.

function nextWeekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  do d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

function bars(closes: number[]): Bar[] {
  const out: Bar[] = []
  let date = '2023-12-29'
  for (const close of closes) {
    date = nextWeekday(date)
    const open = out.length ? out[out.length - 1].close : close
    out.push({ date, open, high: Math.max(open, close) * 1.004, low: Math.min(open, close) * 0.996, close, volume: 1000 })
  }
  return out
}

// Appends days closing at `close` (open at the previous close).
function append(data: Bar[], close: number, days = 1): Bar[] {
  const out = [...data]
  for (let k = 0; k < days; k++) {
    const prev = out[out.length - 1]
    out.push({ date: nextWeekday(prev.date), open: prev.close, high: Math.max(prev.close, close), low: Math.min(prev.close, close), close, volume: 1000 })
  }
  return out
}

const path = (n: number, drift: number, start = 100) => Array.from({ length: n }, (_, i) => start * (1 + drift * i) + 6 * Math.sin(i / 3) + 3 * Math.sin(i / 1.7))

function status(template: StrategyTemplate, params: Record<string, number>, data: Bar[], held = false, timing?: DecisionTiming) {
  const h: Record<string, { shares: number; openedAt: string }> = held ? { 'TW:TEST': { shares: 100, openedAt: data[Math.floor(data.length / 2)].date } } : {}
  return symbolStatus(template, params, { 'TW:TEST': data }, h, undefined, timing)[0]
}

const up = (v: number) => v * 1.001
const down = (v: number) => v * 0.999

describe('rsiPrice', () => {
  it('gives the close at which the next RSI equals the target', () => {
    const closes = path(80, 0.002)
    const state = rsiState(closes, 14)!
    for (const target of [25, 50, 75]) {
      const x = rsiPrice(state, closes[closes.length - 1], 14, target)
      const r = rsi([...closes, x], 14)
      expect(r[r.length - 1]).toBeCloseTo(target, 6)
    }
  })
})

describe('entry and exit prices', () => {
  it('donchian: a close above the entry price breaks out, one below the exit price leaves', () => {
    const params = { entryDays: 20, exitDays: 10, atrStop: 2 }
    const data = bars(path(80, 0.001))
    const { levels } = status('donchian', params, data)
    const entry = levels!.entry!.above!
    expect(status('donchian', params, append(data, up(entry))).state).toBe('enter')
    expect(status('donchian', params, append(data, down(entry))).state).not.toBe('enter')
    const exit = status('donchian', params, data, true).levels!.exit!.below!
    expect(status('donchian', params, append(data, down(exit)), true).state).toBe('exit')
    expect(status('donchian', params, append(data, up(exit)), true).state).not.toBe('exit')
  })

  for (const fast of [1, 5]) {
    it(`ma_cross (fast ${fast}): the cross price is where fast meets slow`, () => {
      const params = { fast, slow: 20, atrStop: 2 }
      // Falling at the end, so fast is under slow and can cross up.
      const data = bars([...path(60, 0.004), ...path(15, -0.004, 120)])
      const st = status('ma_cross', params, data)
      expect(st.state).toBe('wait')
      const x = st.levels!.entry!.above!
      expect(status('ma_cross', params, append(data, up(x))).state).toBe('enter')
      expect(status('ma_cross', params, append(data, down(x))).state).toBe('wait')
      // Held in a rise: a close under the same kind of price exits.
      const rising = bars(path(80, 0.006))
      const exit = status('ma_cross', params, rising, true).levels!.exit!.below!
      expect(status('ma_cross', params, append(rising, down(exit)), true).state).toBe('exit')
      expect(status('ma_cross', params, append(rising, up(exit)), true).state).toBe('hold')
    })
  }

  it('rsi_reversion: enters inside the zone only, exits above the RSI price', () => {
    const params = { rsiDays: 14, entryBelow: 65, exitAbove: 80, trendDays: 20, maxHoldDays: 60, atrStop: 2 }
    // The first rising path whose zone is open (both bounds exist).
    const data = [80, 82, 84, 86, 88, 90, 92, 94, 96, 98].map((n) => bars(path(n, 0.004))).find((d) => status('rsi_reversion', params, d).levels?.entry?.above !== undefined)!
    expect(data).toBeDefined()
    const entry = status('rsi_reversion', params, data).levels!.entry!
    expect(entry.above).toBeLessThan(entry.below!)
    const mid = (entry.above! + entry.below!) / 2
    expect(status('rsi_reversion', params, append(data, mid)).state).toBe('enter')
    expect(status('rsi_reversion', params, append(data, up(entry.below!))).state).not.toBe('enter')
    expect(status('rsi_reversion', params, append(data, down(entry.above!))).state).not.toBe('enter')
    const exit = status('rsi_reversion', params, data, true).levels!.exit!
    expect(exit.note).toMatch(/持有滿 60 個交易日/)
    expect(status('rsi_reversion', params, append(data, up(exit.above!)), true).state).toBe('exit')
    expect(status('rsi_reversion', params, append(data, down(exit.above!)), true).state).toBe('hold')
  })

  it('weekly_breakout: this week’s close while the week is open, next week’s once it closed', () => {
    const params = { entryWeeks: 8, exitWeeks: 4, atrStop: 2 }
    // 79 bars from a Monday end on a Thursday: the week is still open.
    const open = bars(path(79, 0.002))
    const timing = (data: Bar[]): DecisionTiming => ({ cadence: 'weekly', decisionDay: 5, today: data[data.length - 1].date })
    const x = status('weekly_breakout', params, open, false, timing(open)).levels!.entry!.above!
    const fri = append(open, up(x))
    expect(status('weekly_breakout', params, fri, false, timing(fri)).state).toBe('enter')
    const short = append(open, down(x))
    expect(status('weekly_breakout', params, short, false, timing(short)).state).not.toBe('enter')
    // Ended on Friday: next week's whole week decides.
    const closed = bars(path(80, 0.002))
    const y = status('weekly_breakout', params, closed, false, timing(closed)).levels!.entry!.above!
    const week = append(closed, up(y), 5)
    expect(status('weekly_breakout', params, week, false, timing(week)).state).toBe('enter')
  })

  it('names the conditions that are not a price', () => {
    const data = bars(path(80, 0.002))
    expect(status('buy_hold', {}, data).levels?.entry?.note).toMatch(/沒有價格條件/)
    expect(status('momentum_rotation', { lookbackMonths: 3, topK: 1, absoluteFilter: 0 }, data).levels?.entry?.note).toMatch(/前 1 名/)
    expect(status('discretionary', {}, data).levels).toBeUndefined()
  })
})
