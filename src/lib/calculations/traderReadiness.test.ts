import { describe, expect, it } from 'vitest'
import { createDefaultAppData, type PerformanceReview, type Trade } from '../storage/schema'
import {
  computeTraderReadiness,
  fullTimeTarget,
  monthsBetween,
  sleeveTrackRecord,
  type ReadinessInput,
} from './traderReadiness'

const TODAY = '2026-10-12'

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: Math.random().toString(),
    date: '2024-01-10',
    ticker: 'X',
    name: '',
    holdingId: 'sat',
    side: 'buy',
    reason: 'strategy_entry',
    shares: 1,
    price: 1,
    currency: 'TWD',
    checklist: [],
    emotion: 3,
    biasNotes: '',
    createdAt: '',
    ...overrides,
  }
}

function quarter(start: string, end: string, satEnd: number, bench: number): PerformanceReview {
  return {
    id: end,
    periodStart: start,
    periodEnd: end,
    sleeves: [
      { sleeve: 'core_tw', startValue: 800, endValue: 800, netFlow: 0 },
      { sleeve: 'satellite_tw', startValue: 100, endValue: satEnd, netFlow: 0 },
    ],
    benchmarkReturns: { tw: bench, global: bench, bondCash: 0 },
    createdAt: '',
  }
}

const QUARTERS = [
  ['2024-10-01', '2024-12-31'],
  ['2025-01-01', '2025-03-31'],
  ['2025-04-01', '2025-06-30'],
  ['2025-07-01', '2025-09-30'],
  ['2025-10-01', '2025-12-31'],
  ['2026-01-01', '2026-03-31'],
  ['2026-04-01', '2026-06-30'],
  ['2026-07-01', '2026-09-30'],
]

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  const d = createDefaultAppData()
  return {
    assumptions: { ...d.assumptions, monthlyExpenses: 60_000, safeWithdrawalRatePercent: 4, currentNetWorth: 0 },
    foundation: { ...d.foundation },
    holdings: [
      { id: 'sat', ticker: 'X', name: '', sleeve: 'satellite_tw', currency: 'TWD', shares: 1, avgCost: 1, currentPrice: 1, createdAt: '' },
    ],
    trades: [],
    performanceReviews: [],
    policy: d.investmentPolicy,
    disciplineScore: null,
    today: TODAY,
    ...overrides,
  }
}

describe('fullTimeTarget', () => {
  it('needs living costs ÷ withdrawal rate plus a cash buffer', () => {
    const d = createDefaultAppData()
    const t = fullTimeTarget({ ...d.assumptions, monthlyExpenses: 60_000, safeWithdrawalRatePercent: 4 }, d.foundation)
    expect(t.annualExpenses).toBe(720_000)
    expect(t.portfolioTarget).toBe(18_000_000)
    expect(t.bufferTarget).toBe(1_440_000)
  })
})

describe('monthsBetween', () => {
  it('counts whole calendar months', () => {
    expect(monthsBetween('2024-10-12', '2026-10-12')).toBe(24)
    expect(monthsBetween('2024-10-13', '2026-10-12')).toBe(23)
  })
})

describe('sleeveTrackRecord', () => {
  it('chains quarterly sleeve returns and annualizes them', () => {
    const reviews = QUARTERS.map(([s, e]) => quarter(s, e, 103, 2))
    const r = sleeveTrackRecord(reviews, createDefaultAppData().investmentPolicy, TODAY)!
    expect(r.years).toBeCloseTo(2, 1)
    expect(r.annualReturn).toBeCloseTo(1.03 ** 4 - 1, 2)
    expect(r.benchmarkAnnualReturn).toBeCloseTo(1.02 ** 4 - 1, 2)
    expect(r.maxDrawdown).toBe(0)
  })

  it('ignores reviews older than the window', () => {
    expect(sleeveTrackRecord([quarter('2020-01-01', '2020-03-31', 110, 0)], createDefaultAppData().investmentPolicy, TODAY)).toBeNull()
  })
})

describe('computeTraderReadiness', () => {
  it('starts with nothing met', () => {
    const r = computeTraderReadiness(input())
    expect(r.metCount).toBe(0)
    expect(r.ready).toBe(false)
  })

  it('passes all five gates for a proven trader with enough assets and cash', () => {
    const buys = [trade({ date: '2024-09-01' })]
    const sells = Array.from({ length: 30 }, () => trade({ side: 'sell', reason: 'strategy_exit', date: '2026-01-01' }))
    const r = computeTraderReadiness(
      input({
        assumptions: { ...input().assumptions, currentNetWorth: 18_500_000 },
        foundation: { emergencyFundAmount: 1_500_000, emergencyFundTargetMonths: 6, livingBufferMonths: 24 },
        trades: [...buys, ...sells],
        performanceReviews: QUARTERS.map(([s, e]) => quarter(s, e, 103, 2)),
        disciplineScore: 85,
      }),
    )
    expect(r.items.filter((i) => !i.met).map((i) => i.key)).toEqual([])
    expect(r.ready).toBe(true)
  })

  it('fails performance when the sleeve lags or draws down past the limit', () => {
    const lagging = computeTraderReadiness(
      input({ performanceReviews: QUARTERS.map(([s, e]) => quarter(s, e, 101, 2)) }),
    )
    expect(lagging.items.find((i) => i.key === 'performance')!.met).toBe(false)

    const crash = QUARTERS.map(([s, e], i) => quarter(s, e, i === 2 ? 60 : 120, 2))
    const r = computeTraderReadiness(input({ performanceReviews: crash }))
    expect(r.items.find((i) => i.key === 'performance')!.met).toBe(false)
  })
})
