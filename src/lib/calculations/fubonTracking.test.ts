import { describe, expect, it } from 'vitest'
import { gapSignals, isOutlookFresh, latestOutlook, monthEndClose, monthEndCloses, trackForecasts } from './fubonTracking'
import type { FubonOutlook } from '../storage/schema'

function outlook(reportDate: string, overrides: Partial<FubonOutlook> = {}): FubonOutlook {
  return {
    id: reportDate,
    reportTitle: `富邦總經觀點-${reportDate.slice(5, 7)}月市場展望`,
    reportDate,
    pdfUrl: '',
    createdAt: '',
    markdown: '',
    sources: [],
    estimatedCostUsd: 0,
    summary: '',
    sections: [],
    allocation: [],
    forecasts: [],
    actuals: [],
    coverage: [],
    ...overrides,
  }
}

const sep = outlook('2026-09-02', {
  forecasts: [
    { index: 'sp500', low: 7200, high: 7900 },
    { index: 'taiex', low: 44000, high: 48000 },
    { index: 'usdtwd', low: 31.3, high: 32.0 },
  ],
})
const oct = outlook('2026-10-02', {
  forecasts: [{ index: 'sp500', low: 7400, high: 8100 }],
  actuals: [
    { index: 'sp500', value: 7950 },
    { index: 'usdtwd', value: 31.5 },
  ],
})

describe('trackForecasts', () => {
  it("checks each forecast against the next report's actuals", () => {
    const { evaluations, rows } = trackForecasts([oct, sep])
    const byIndex = Object.fromEntries(evaluations.map((e) => [e.index, e]))
    expect(byIndex.sp500).toMatchObject({ month: '2026-09', actual: 7950, result: 'miss' })
    expect(byIndex.usdtwd).toMatchObject({ actual: 31.5, result: 'hit' })
    expect(byIndex.taiex).toMatchObject({ actual: null, result: 'nodata' })

    const sp = rows.find((r) => r.index === 'sp500')!
    expect(sp.current).toEqual({ low: 7400, high: 8100 })
    expect(sp).toMatchObject({ hits: 0, evaluated: 1 })
    expect(rows.find((r) => r.index === 'usdtwd')).toMatchObject({ hits: 1, evaluated: 1 })
  })

  it('fills TAIEX from TWSE month-end closes', () => {
    const history = [
      { date: '2026-09-29', close: 45000 },
      { date: '2026-09-30', close: 46500 },
      { date: '2026-10-01', close: 46800 },
    ]
    const { evaluations } = trackForecasts([sep, oct], history)
    expect(evaluations.find((e) => e.index === 'taiex')).toMatchObject({ actual: 46500, result: 'hit' })
  })

  it('evaluates the latest month for TAIEX once the month is over', () => {
    const history = [
      { date: '2026-09-30', close: 49000 },
      { date: '2026-10-01', close: 49100 },
    ]
    const { evaluations } = trackForecasts([sep], history)
    expect(evaluations).toEqual([
      { month: '2026-09', index: 'taiex', low: 44000, high: 48000, actual: 49000, source: 'market', result: 'miss' },
    ])
  })

  it('does not pair reports that skip a month', () => {
    const dec = outlook('2026-12-02', { actuals: [{ index: 'sp500', value: 7500 }] })
    const { evaluations } = trackForecasts([sep, dec])
    expect(evaluations.find((e) => e.index === 'sp500')?.result).toBe('nodata')
  })
})

describe('market closes', () => {
  const closes = {
    sp500: [
      { date: '2026-09-30', value: 7651.5 },
      { date: '2026-10-16', value: 7659.4 },
    ],
  }

  it("fills an actual the next report did not state, and marks its source", () => {
    const { evaluations } = trackForecasts([sep, { ...oct, actuals: [] }], [], closes)
    const sp = evaluations.find((e) => e.index === 'sp500')!
    expect(sp).toMatchObject({ actual: 7651.5, source: 'market', result: 'hit' })
    const fromReport = trackForecasts([sep, oct], [], closes).evaluations.find((e) => e.index === 'sp500')!
    expect(fromReport).toMatchObject({ actual: 7950, source: 'report' })
  })

  it('waits until the month is over, and shows the latest level', () => {
    const { evaluations, rows } = trackForecasts([oct], [], closes)
    expect(evaluations.find((e) => e.index === 'sp500')).toBeUndefined()
    expect(rows.find((r) => r.index === 'sp500')!.latest).toEqual({ date: '2026-10-16', value: 7659.4 })
  })

  it('keeps the last close of each month', () => {
    expect(
      monthEndCloses([
        { date: '2026-09-29', value: 1 },
        { date: '2026-09-30', value: 2 },
        { date: '2026-10-01', value: 3 },
      ]),
    ).toEqual([
      { date: '2026-09-30', value: 2 },
      { date: '2026-10-01', value: 3 },
    ])
  })
})

describe('helpers', () => {
  it('lists signals not fully covered, including ones not mentioned', () => {
    const o = outlook('2026-09-02', {
      coverage: [
        { signal: 'liquidity.policyRate', status: 'covered', note: '', page: 'p.4' },
        { signal: 'growth.usPmi', status: 'missing', note: '', page: '' },
        { signal: 'inflation.usCpi', status: 'partial', note: '', page: 'p.4' },
      ],
    })
    const gaps = gapSignals(o)
    expect(gaps).toHaveLength(16)
    expect(gaps).not.toContain('liquidity.policyRate')
    expect(gaps).toContain('inflation.usCpi')
  })

  it('judges freshness and picks the latest report', () => {
    expect(isOutlookFresh(sep, '2026-10-11')).toBe(true)
    expect(isOutlookFresh(sep, '2026-11-20')).toBe(false)
    expect(latestOutlook([sep, oct])?.reportDate).toBe('2026-10-02')
    expect(monthEndClose([], '2026-09')).toBeNull()
  })
})
