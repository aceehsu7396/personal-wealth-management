import { describe, expect, it } from 'vitest'
import type { MacroCheckIn } from '../storage/schema'
import type { MacroData } from './macroData'
import { AUTO_NOTE } from './signalRules'
import { indicatorSeries, judgementTimeline, lastYears, signalMatrix, sourceOf } from './history'

const guardrails = { rebalancingBandPercent: 5, maxTiltPercent: 10, minEquityFloorPercent: 30, reviewCadenceMonths: 3 }

function checkIn(date: string, o: Partial<MacroCheckIn> = {}): MacroCheckIn {
  return {
    id: date,
    date,
    growth: { usPmi: 'flat', usEmployment: 'flat', twBusinessSignal: 'flat', twExportOrders: 'flat' },
    inflation: { usCpi: 'flat', twCpi: 'flat' },
    liquidity: { policyRate: 0, yieldCurve: 0, creditSpread: 0, centralBankBalanceSheet: 0, usDollar: 0 },
    sentiment: { valuation: 0, credit: 0, ipoHype: 0, media: 0, margin: 0, vix: 0 },
    note: AUTO_NOTE,
    createdAt: '',
    ...o,
  }
}

describe('judgementTimeline', () => {
  it('lists months newest first with what changed', () => {
    const aug = checkIn('2026-08-15')
    const sep = checkIn('2026-09-15', {
      liquidity: { ...aug.liquidity, policyRate: 1, yieldCurve: 1 },
      sentiment: { ...aug.sentiment, vix: 1 },
      note: '已手動修正',
    })
    const rows = judgementTimeline([sep, aug], guardrails)
    expect(rows.map((r) => r.month)).toEqual(['2026-09', '2026-08'])
    expect(rows[1].changes).toEqual([])
    expect(rows[0].source).toBe('manual')
    expect(rows[0].changes).toContain('流動性 0 → +2')
    expect(rows[0].changes).toContain('政策利率方向（Fed、台灣央行）：中性 → 寬鬆')
    expect(rows[0].changes).toContain('恐慌指數 VIX：正常 → 過熱')
  })

  it('keeps the latest check-in of each month', () => {
    const rows = judgementTimeline([checkIn('2026-09-01'), checkIn('2026-09-20', { growth: { usPmi: 'up', usEmployment: 'up', twBusinessSignal: 'up', twExportOrders: 'up' } })], guardrails)
    expect(rows).toHaveLength(1)
    expect(rows[0].checkIn.date).toBe('2026-09-20')
  })

  it('names the source of each month', () => {
    expect(sourceOf(checkIn('2026-09-01'))).toBe('auto')
    expect(sourceOf(checkIn('2026-09-01', { note: 'AI 依富邦報告與網路補查自動判斷' }))).toBe('ai')
  })
})

describe('signalMatrix', () => {
  it('lays signals out by month with metrics and reasons', () => {
    const m = signalMatrix([
      checkIn('2026-09-10', { metrics: { 'sentiment.vix': 15.3 }, reasons: { 'sentiment.vix': 'VIX 15.3', 'sentiment.media': '暫列中性，請手動確認' } }),
      checkIn('2026-10-10', { sentiment: { valuation: 0, credit: 0, ipoHype: 0, media: 0, margin: 0, vix: 1 } }),
    ])
    expect(m.months).toEqual(['2026-09', '2026-10'])
    expect(m.rows).toHaveLength(17)
    const vix = m.rows.find((r) => r.key === 'sentiment.vix')!
    expect(vix.cells[0]).toMatchObject({ value: 0, metric: 15.3, reason: 'VIX 15.3' })
    expect(vix.cells[1]).toMatchObject({ value: 1, metric: null })
    expect(m.rows.find((r) => r.key === 'sentiment.media')!.cells[0]!.manual).toBe(true)
  })

  it('keeps only the most recent months', () => {
    const many = Array.from({ length: 15 }, (_, i) => checkIn(`2025-${String((i % 12) + 1).padStart(2, '0')}-01`.replace('2025', i < 12 ? '2025' : '2026')))
    expect(signalMatrix(many, 12).months).toHaveLength(12)
  })
})

describe('indicatorSeries', () => {
  const months = Array.from({ length: 24 }, (_, i) => {
    const total = 2024 * 12 + 10 + i
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
  })
  const data = {
    generatedAt: '',
    errors: [],
    series: {
      CPIAUCSL: months.map((date, i) => ({ date, value: 100 * 1.003 ** i })),
      VIXCLS: [
        { date: '2026-09-29', value: 20 },
        { date: '2026-09-30', value: 18 },
        { date: '2026-10-15', value: 16 },
      ],
    },
    margin: null,
    fubon: [],
  } as MacroData

  it('derives year-over-year rates and month-end values with rule thresholds', () => {
    const charts = indicatorSeries(data)
    const cpi = charts.find((c) => c.id === 'cpi')!
    expect(cpi.points).toHaveLength(12)
    expect(cpi.points[0].value).toBeCloseTo((1.003 ** 12 - 1) * 100, 1)
    const vix = charts.find((c) => c.id === 'vix')!
    expect(vix.points.map((p) => p.value)).toEqual([18, 16])
    expect(vix.thresholds.map((t) => t.value)).toEqual([13, 30])
    expect(charts.find((c) => c.id === 'unrate')).toBeUndefined()
  })

  it('cuts a series to the last N years', () => {
    const pts = months.map((date) => ({ date, value: 1 }))
    expect(lastYears(pts, 1)).toHaveLength(12)
  })
})
