import { describe, expect, it } from 'vitest'
import { classifyDay, creditFacet, facetScores, fxFacet, ratesFacet, valuationFacet, regimeContext, regimeHistory, type DayMetrics } from './regime'
import { createDefaultRegimeParams } from '../storage/schema'
import type { MacroAssessment } from '../calculations/macroRegime'
import type { IndexPoint } from './indices'

const day = (over: Partial<DayMetrics>): DayMetrics => ({
  close: 110,
  sma60: 105,
  sma200: 100,
  slope200: 1,
  drawdown: -2,
  trough: -3,
  ret20: 1,
  ret252: 10,
  rsi14: 55,
  volPercentile: 50,
  vix: 16,
  ...over,
})

// A noisy uptrend: +0.1 a day with ±0.5 swings keeps RSI near the middle.
const date = (i: number) => new Date(Date.UTC(2022, 0, 3) + i * 86400000).toISOString().slice(0, 10)
const uptrend = (n: number): IndexPoint[] => Array.from({ length: n }, (_, i) => ({ date: date(i), close: 100 + i * 0.1 + (i % 2 ? 0.5 : -0.5) }))
const extend = (points: IndexPoint[], closes: number[]) => [...points, ...closes.map((close, k) => ({ date: date(points.length + k), close }))]

describe('classifyDay', () => {
  it('reads each regime in rule order', () => {
    expect(classifyDay(day({}))).toBe('bull')
    expect(classifyDay(day({ rsi14: 75 }))).toBe('overheated')
    expect(classifyDay(day({ ret252: 35 }))).toBe('overheated')
    expect(classifyDay(day({ drawdown: -12 }))).toBe('correction')
    expect(classifyDay(day({ drawdown: -22 }))).toBe('bear')
    expect(classifyDay(day({ close: 95, sma60: 98, slope200: -0.5, drawdown: -8 }))).toBe('bear')
    expect(classifyDay(day({ ret20: -16, drawdown: -16 }))).toBe('crash')
    expect(classifyDay(day({ drawdown: -18, vix: 40 }))).toBe('crash')
    expect(classifyDay(day({ trough: -17, drawdown: -6 }))).toBe('rebound')
    expect(classifyDay(day({ close: 99, sma60: 98, slope200: -0.2, drawdown: -5 }))).toBe('range')
    expect(classifyDay(day({ sma200: NaN }))).toBeNull()
  })
})

describe('regimeHistory', () => {
  const base = uptrend(300)
  const top = base[base.length - 1].close

  it('starts in a bull market', () => {
    const { segments } = regimeHistory(base)
    expect(segments.at(-1)?.regime).toBe('bull')
  })

  it('needs three sessions to confirm a correction, and ignores a one-day dip', () => {
    const blip = regimeHistory(extend(base, [top * 0.88, top]))
    expect(blip.segments.at(-1)?.regime).toBe('bull')
    const two = regimeHistory(extend(base, [top * 0.89, top * 0.88, top * 0.88]))
    expect(two.segments.at(-1)?.regime).toBe('correction')
    expect(two.segments.at(-1)?.start).toBe(date(300))
    expect(two.segments.at(-1)?.confirmedOn).toBe(date(302))
  })

  it('confirms a crash the same day', () => {
    const drop = Array.from({ length: 10 }, (_, k) => top * (1 - 0.02 * (k + 1)))
    const { segments } = regimeHistory(extend(base, drop))
    const crash = segments.find((s) => s.regime === 'crash')
    expect(crash).toBeDefined()
    expect(crash!.start).toBe(crash!.confirmedOn)
  })

  it('records what the index did after each regime began', () => {
    const { segments } = regimeHistory(uptrend(500))
    expect(segments[0].after.m1).not.toBeNull()
  })
})

describe('regimeContext', () => {
  const history = regimeHistory(extend(uptrend(300), [115, 114, 114]))
  const params = createDefaultRegimeParams()

  it('applies the row and halves it under a strong macro headwind', () => {
    const ctx = regimeContext(history, params, null, '2026-11-12')!
    expect(ctx.regime).toBe('correction')
    expect(ctx.multiplier).toBe(0.5)
    expect(ctx.changedRecently).toBe(true)
    const halved = regimeContext(history, params, { stance: 'strong_headwind' } as MacroAssessment, '2026-11-12')!
    expect(halved.multiplier).toBe(0.25)
    expect(halved.macroHalved).toBe(true)
  })

  it('flags the cooling-off week after signing', () => {
    const signed = { ...params, signedAt: '2026-11-10T00:00:00Z' }
    expect(regimeContext(history, signed, null, '2026-11-12')!.coolingOff).toBe(true)
    expect(regimeContext(history, signed, null, '2026-11-20')!.coolingOff).toBe(false)
  })
})

describe('facetScores', () => {
  it('scores what it has and marks the rest as missing', () => {
    const facets = facetScores({
      taiex: null,
      vix: null,
      breadth: { date: '2026-11-11', up: 700, down: 200, unchanged: 50 },
      usBreadth: { above: false },
      flows: [],
      margin: [],
      macro: null,
    })
    expect(facets.find((f) => f.key === 'breadth')?.score).toBe(1)
    expect(facets.find((f) => f.key === 'trend')?.score).toBeNull()
    expect(facets).toHaveLength(10)
    expect(facets.find((f) => f.key === 'credit')?.score).toBeNull()
  })
})

describe('stage 5 facets', () => {
  const months = (values: number[], end = '2026-10-01') =>
    values.map((value, i) => {
      const d = new Date(`${end}T00:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() - (values.length - 1 - i))
      return { date: d.toISOString().slice(0, 10), value }
    })
  const macro = (series: Record<string, { date: string; value: number }[]>, usdtwd?: { date: string; value: number }[]) =>
    ({ series, indexCloses: usdtwd ? { usdtwd } : {} }) as never

  it('scores credit by the HYG ÷ IEF move', () => {
    expect(creditFacet(macro({ HYG_IEF: months([1, 1, 1, 0.96]) })).score).toBe(-2)
    expect(creditFacet(macro({ HYG_IEF: months([1, 1, 1, 0.985]) })).score).toBe(-1)
    expect(creditFacet(macro({ HYG_IEF: months([1, 1, 1, 1.01]) })).score).toBe(1)
    expect(creditFacet(null).score).toBeNull()
  })

  it('flags an un-inverting curve and rewards cuts with a positive curve', () => {
    expect(ratesFacet(macro({ T10Y2Y: months([-0.3, -0.1, 0.2]), FEDFUNDS: months([5, 5, 5]) })).score).toBe(-1)
    expect(ratesFacet(macro({ T10Y2Y: months([0.4, 0.5, 0.6, 0.6]), FEDFUNDS: months([5, 4.75, 4.5, 4.25]) })).score).toBe(1)
  })

  it('needs a year of P/E history before scoring valuation', () => {
    expect(valuationFacet([{ date: '2026-11-03', pe: 22 }]).score).toBeNull()
    const year = Array.from({ length: 250 }, (_, i) => ({ date: `d${String(i).padStart(3, '0')}`, pe: 15 + i * 0.02 }))
    expect(valuationFacet(year).score).toBe(-2)
  })

  it('reads a weaker dollar and stronger NT dollar as favourable', () => {
    expect(fxFacet(macro({ DTWEXBGS: months([120, 119, 118, 116]) }, months([32, 31.5, 31, 30.8]))).score).toBe(1)
    expect(fxFacet(macro({ DTWEXBGS: months([116, 118, 119, 120]) })).score).toBe(-1)
  })
})
