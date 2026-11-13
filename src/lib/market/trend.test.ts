import { describe, expect, it } from 'vitest'
import { breadthRatio, indexTrend, marketSummary, vixBand } from './trend'
import type { IndexPoint } from './indices'

// Weekday-free synthetic dates; only the order matters to the rules.
function series(closes: number[], start = '2024-01-01'): IndexPoint[] {
  const d0 = new Date(`${start}T00:00:00Z`)
  return closes.map((close, i) => {
    const d = new Date(d0)
    d.setUTCDate(d.getUTCDate() + i)
    return { date: d.toISOString().slice(0, 10), close }
  })
}
const ramp = (n: number, from: number, step: number) => Array.from({ length: n }, (_, i) => from + i * step)

describe('trend state', () => {
  it('reads a steady rise as bull', () => {
    const t = indexTrend(series(ramp(300, 100, 0.5)))!
    expect(t.state).toBe('bull')
    expect(t.drawdown).toBe(0)
    expect(t.flags.map((f) => f.label)).toContain('超買')
  })

  it('reads a break below the 60-day line in an uptrend as weakening', () => {
    const t = indexTrend(series([...ramp(300, 100, 0.5), 230]))!
    expect(t.state).toBe('weakening')
    expect(t.stateRule).toContain('跌破 60 日線')
  })

  it('reads a steady fall as bear, and a bounce above the 60-day line as strengthening', () => {
    const fall = ramp(300, 300, -0.5)
    expect(indexTrend(series(fall))!.state).toBe('bear')
    expect(indexTrend(series([...fall, 170]))!.state).toBe('strengthening')
  })

  it('flags corrections and bear markets from the 52-week high', () => {
    const base = ramp(300, 100, 0.5)
    const high = base[base.length - 1]
    expect(indexTrend(series([...base, high * 0.85]))!.flags.map((f) => f.label)).toContain('修正')
    expect(indexTrend(series([...base, high * 0.75]))!.flags.map((f) => f.label)).toContain('空頭市場')
  })

  it('needs 220 sessions for a state', () => {
    const t = indexTrend(series(ramp(150, 100, 0.5)))!
    expect(t.state).toBeNull()
    expect(t.stateRule).toContain('資料不足')
  })

  it('computes returns, the year-to-date base and volatility rank', () => {
    const pts = series(ramp(400, 100, 1), '2025-06-01')
    const t = indexTrend(pts)!
    expect(t.returns.w1).toBeCloseTo((499 / 494 - 1) * 100, 1)
    const dec31 = pts.find((p) => p.date === '2025-12-31')!.close
    expect(t.returns.ytd).toBeCloseTo((499 / dec31 - 1) * 100, 1)
    expect(t.volPercentile).not.toBeNull()
  })
})

describe('breadth and VIX', () => {
  it('compares equal weight with cap weight against its 60-day average', () => {
    const spy = series(ramp(80, 100, 1))
    expect(breadthRatio(series(ramp(80, 100, 1.2)), spy)!.above).toBe(true)
    expect(breadthRatio(series(ramp(80, 100, 0.8)), spy)!.above).toBe(false)
    expect(breadthRatio(series(ramp(30, 100, 1)), spy)).toBeNull()
  })

  it('bands the VIX level', () => {
    expect([14, 15, 24.9, 25, 30].map((v) => vixBand(v).label)).toEqual(['平靜', '正常', '正常', '警戒', '恐慌'])
  })
})

describe('summary', () => {
  it('writes the Taiwan lines in a fixed format with the sleeve hint', () => {
    const fall = indexTrend(series(ramp(300, 300, -0.5)))
    const lines = marketSummary('TW', {
      trends: { TAIEX: fall, TPEx: fall },
      breadth: { date: '2026-11-04', up: 438, down: 544, unchanged: 99 },
      flows: Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, foreign: -1e10, trust: 2e9, dealer: 0 })),
      margin: [],
      usBreadth: null,
    })
    expect(lines[0]).toMatch(/^加權指數 150.5（−0.33%），空頭/)
    expect(lines).toContain('上市股票上漲 438 家、下跌 544 家（2026-11-04）。')
    expect(lines).toContain('外資近 5 日賣超 500 億、近 20 日賣超 2,000 億；投信近 5 日買超 100 億。')
    expect(lines.at(-1)).toContain('依局勢參數表')
  })
})
