import { describe, expect, it } from 'vitest'
import {
  attributePeriod,
  benchmarkWeights,
  modifiedDietz,
  netFlowsBySleeve,
  summarizeAttribution,
} from './attribution'
import {
  createDefaultInvestmentPolicy,
  type PerformanceReview,
  type SleevePerformance,
  type Trade,
} from '../storage/schema'

const policy = createDefaultInvestmentPolicy()

function sleeves(values: Partial<Record<SleevePerformance['sleeve'], [number, number, number?]>>): SleevePerformance[] {
  return Object.entries(values).map(([sleeve, [startValue, endValue, netFlow = 0]]) => ({
    sleeve: sleeve as SleevePerformance['sleeve'],
    startValue,
    endValue,
    netFlow,
  }))
}

function review(
  periodEnd: string,
  rows: SleevePerformance[],
  benchmarkReturns = { tw: 10, global: 10, bondCash: 10 },
): PerformanceReview {
  const end = new Date(`${periodEnd}T00:00:00Z`)
  end.setUTCMonth(end.getUTCMonth() - 3)
  return {
    id: periodEnd,
    periodStart: end.toISOString().slice(0, 10),
    periodEnd,
    sleeves: rows,
    benchmarkReturns,
    createdAt: '',
  }
}

describe('modifiedDietz', () => {
  it('weights a mid-period flow by half', () => {
    expect(modifiedDietz(100, 120, 10)).toBeCloseTo(10 / 105)
    expect(modifiedDietz(0, 0, 0)).toBe(0)
  })
})

describe('benchmarkWeights', () => {
  it('normalizes the core targets to 100%', () => {
    const w = benchmarkWeights(policy)
    expect(w.tw + w.global + w.bondCash).toBeCloseTo(1)
    expect(w.global).toBeCloseTo(35 / 70)
  })
})

describe('attributePeriod', () => {
  it('has no excess when every class earns its benchmark at target weights', () => {
    const result = attributePeriod(
      review('2026-03-31', sleeves({ core_tw: [25, 27.5], core_global: [35, 38.5], core_bond_cash: [10, 11] })),
      policy,
    )
    expect(result.portfolioReturn).toBeCloseTo(0.1)
    expect(result.excessReturn).toBeCloseTo(0)
    expect(result.allocationEffect).toBeCloseTo(0)
    expect(result.selectionEffect).toBeCloseTo(0)
  })

  it('credits stock picking to the selection effect', () => {
    const result = attributePeriod(
      review(
        '2026-03-31',
        sleeves({ core_tw: [20, 22], satellite_tw: [5, 6], core_global: [35, 38.5], core_bond_cash: [10, 11] }),
      ),
      policy,
    )
    // Satellite TW returned 20% against a 10% benchmark on a 5/70 weight.
    expect(result.selectionEffect).toBeCloseTo((25 / 70) * (0.12 - 0.1))
    expect(result.satelliteReturn).toBeCloseTo(0.2)
    expect(result.satelliteBenchmarkReturn).toBeCloseTo(0.1)
  })

  it('credits overweighting the winning class to the allocation effect', () => {
    const result = attributePeriod(
      review('2026-03-31', sleeves({ core_tw: [50, 60], core_global: [20, 20] }), {
        tw: 20,
        global: 0,
        bondCash: 0,
      }),
      policy,
    )
    expect(result.allocationEffect).toBeGreaterThan(0)
    expect(result.selectionEffect).toBeCloseTo(0)
  })
})

describe('summarizeAttribution', () => {
  it('chains returns and counts consecutive lagging satellite years', () => {
    const lagging = (end: string) =>
      review(end, sleeves({ core_tw: [60, 66], satellite_tw: [10, 10.5] }))
    const reviews = [
      review('2024-12-31', sleeves({ core_tw: [60, 66], satellite_tw: [10, 13] })),
      lagging('2025-12-31'),
      lagging('2026-12-31'),
    ]
    const summary = summarizeAttribution(reviews, policy)
    expect(summary.yearlySatellite.map((y) => y.year)).toEqual(['2024', '2025', '2026'])
    expect(summary.consecutiveSatelliteLaggingYears).toBe(2)
    expect(summary.sharpeRatio).toBeNull()
  })

  it('tracks the maximum drawdown across periods', () => {
    const reviews = [
      review('2026-03-31', sleeves({ core_tw: [100, 120] })),
      review('2026-06-30', sleeves({ core_tw: [120, 90] })),
      review('2026-09-30', sleeves({ core_tw: [90, 100] })),
    ]
    const summary = summarizeAttribution(reviews, policy)
    expect(summary.maxDrawdown).toBeCloseTo(-0.25)
    expect(summary.cumulativeReturn).toBeCloseTo(0)
  })
})

describe('netFlowsBySleeve', () => {
  it('sums buys minus sells within the period, converting USD', () => {
    const holdings = [
      { id: 'a', sleeve: 'core_tw' },
      { id: 'b', sleeve: 'satellite_us' },
    ] as Parameters<typeof netFlowsBySleeve>[1]
    const base = { name: '', reason: 'core_dca', checklist: [], emotion: 3, biasNotes: '', createdAt: '', ticker: '' }
    const trades = [
      { ...base, id: '1', date: '2026-02-01', holdingId: 'a', side: 'buy', shares: 10, price: 100, currency: 'TWD' },
      { ...base, id: '2', date: '2026-03-01', holdingId: 'b', side: 'buy', shares: 1, price: 10, currency: 'USD' },
      { ...base, id: '3', date: '2026-03-15', holdingId: 'a', side: 'sell', shares: 2, price: 100, currency: 'TWD' },
      { ...base, id: '4', date: '2026-05-01', holdingId: 'a', side: 'buy', shares: 99, price: 100, currency: 'TWD' },
    ] as Trade[]
    const flows = netFlowsBySleeve(trades, holdings, '2026-01-01', '2026-03-31', 30)
    expect(flows.core_tw).toBe(800)
    expect(flows.satellite_us).toBe(300)
  })
})
