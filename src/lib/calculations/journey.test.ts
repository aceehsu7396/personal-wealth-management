import { describe, expect, it } from 'vitest'
import {
  computeJourney,
  computeLearningStage,
  effectivePolicy,
  emergencyFundTarget,
  monthlyExpenseBaseline,
  type JourneyState,
} from './journey'
import {
  createDefaultAppData,
  type Holding,
  type MacroCheckIn,
  type PerformanceReview,
  type StockThesis,
  type Trade,
} from '../storage/schema'

const TODAY = '2026-10-04'

function base(): JourneyState {
  const d = createDefaultAppData()
  return {
    profile: d.profile,
    assumptions: {
      ...d.assumptions,
      currentNetWorth: 5_000_000,
      monthlyIncome: 150_000,
      savingsRatePercent: 50,
      monthlyExpenses: 50_000,
    },
    monthlyRecords: [],
    foundation: { emergencyFundAmount: 0, emergencyFundTargetMonths: 6 },
    investmentPolicy: d.investmentPolicy,
    holdings: [],
    trades: [],
    macroCheckIns: [],
    stockTheses: [],
    performanceReviews: [],
  }
}

function holding(id: string, sleeve: Holding['sleeve']): Holding {
  return { id, ticker: id, name: '', sleeve, currency: 'TWD', shares: 10, avgCost: 1, currentPrice: 1, createdAt: '' }
}

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: Math.random().toString(),
    date: '2026-07-01',
    ticker: 'X',
    name: '',
    side: 'buy',
    reason: 'core_dca',
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

function macro(date: string): MacroCheckIn {
  return {
    id: date,
    date,
    growth: { usPmi: 'flat', usEmployment: 'flat', twBusinessSignal: 'flat', twExportOrders: 'flat' },
    inflation: { usCpi: 'flat', twCpi: 'flat' },
    liquidity: { policyRate: 0, yieldCurve: 0, creditSpread: 0, centralBankBalanceSheet: 0, usDollar: 0 },
    sentiment: { valuation: 0, credit: 0, ipoHype: 0, media: 0, margin: 0, vix: 0 },
    createdAt: '',
  }
}

// A learner who has finished every satellite prerequisite.
function readyForSatellite(): JourneyState {
  const s = base()
  return {
    ...s,
    foundation: { emergencyFundAmount: 300_000, emergencyFundTargetMonths: 6 },
    investmentPolicy: { ...s.investmentPolicy, signedAt: '2026-06-01' },
    holdings: [holding('tw', 'core_tw'), holding('gl', 'core_global')],
    trades: ['2026-07-05', '2026-08-05', '2026-09-05'].map((date) => trade({ date, holdingId: 'tw' })),
    macroCheckIns: [macro('2026-09-01')],
  }
}

describe('monthlyExpenseBaseline', () => {
  it('falls back to the FIRE calculator when nothing is recorded', () => {
    expect(monthlyExpenseBaseline(base())).toBe(50_000)
  })

  it('averages the three most recent recorded months', () => {
    const rec = (month: string, amount: number) => ({
      id: month,
      month,
      income: [],
      expenses: [{ name: 'x', amount }],
      investments: [],
      createdAt: '',
    })
    const state = {
      ...base(),
      monthlyRecords: [rec('2026-06', 10_000), rec('2026-07', 40_000), rec('2026-08', 50_000), rec('2026-09', 60_000)],
    }
    expect(monthlyExpenseBaseline(state)).toBe(50_000)
    expect(emergencyFundTarget(state)).toBe(300_000)
  })
})

describe('computeJourney', () => {
  it('starts a new user at step 1.1 with satellite locked', () => {
    const fresh = { ...base(), assumptions: createDefaultAppData().assumptions }
    const report = computeJourney(fresh)
    expect(report.nextStep?.id).toBe('1.1')
    expect(report.satelliteUnlocked).toBe(false)
    expect(report.missingForSatellite.map((s) => s.id)).toEqual(['1.1', '1.2', '1.4', '2.1', '2.3', '3.1'])
  })

  it('requires the emergency fund to cover the target months of spending', () => {
    const short = computeJourney({ ...base(), foundation: { emergencyFundAmount: 299_999, emergencyFundTargetMonths: 6 } })
    const full = computeJourney({ ...base(), foundation: { emergencyFundAmount: 300_000, emergencyFundTargetMonths: 6 } })
    const step = (r: typeof short) => r.stages[0].steps.find((s) => s.id === '1.2')!
    expect(step(short).done).toBe(false)
    expect(step(full).done).toBe(true)
  })

  it('counts DCA and macro months by distinct calendar month', () => {
    const s = readyForSatellite()
    const sameMonth = computeJourney({
      ...s,
      trades: ['2026-09-01', '2026-09-15', '2026-09-28'].map((date) => trade({ date })),
    })
    expect(sameMonth.stages[1].steps.find((x) => x.id === '2.3')!.done).toBe(false)
    expect(computeJourney(s).stages[1].steps.find((x) => x.id === '2.3')!.done).toBe(true)
  })

  it('unlocks satellite once every prerequisite is done', () => {
    const report = computeJourney(readyForSatellite())
    expect(report.satelliteUnlocked).toBe(true)
    expect(report.missingForSatellite).toEqual([])
    // 3.2 (three macro months) is not a prerequisite, so it is the next step.
    expect(report.nextStep?.id).toBe('3.2')
  })

  it('detects a satellite buy through the holding sleeve', () => {
    const s = readyForSatellite()
    const report = computeJourney({
      ...s,
      holdings: [...s.holdings, holding('sat', 'satellite_tw')],
      trades: [...s.trades, trade({ reason: 'tranche_1', holdingId: 'sat' })],
    })
    expect(report.stages[3].steps.find((x) => x.id === '4.2')!.done).toBe(true)
  })
})

describe('computeLearningStage', () => {
  const thesis = (i: number): StockThesis => ({
    id: `t${i}`,
    ticker: `${i}`,
    name: '',
    market: 'TW',
    sector: 'x',
    lynchCategory: 'stalwart',
    inCircleOfCompetence: true,
    status: 'watch',
    thesis: 'a',
    drivers: 'b',
    killCriteria: 'c',
    sources: 'd',
    preMortem: 'e',
    fiveForces: { rivalry: 3, newEntrants: 3, substitutes: 3, buyerPower: 3, supplierPower: 3 },
    powers: {
      scaleEconomies: 3,
      networkEconomies: 0,
      counterPositioning: 0,
      switchingCosts: 0,
      branding: 0,
      corneredResource: 0,
      processPower: 0,
    },
    fScore: 6,
    hasUnexplainedRedFlags: false,
    fairValueBear: 1,
    fairValueBase: 2,
    fairValueBull: 3,
    currentPrice: 2,
    updatedAt: '',
    createdAt: '',
  })

  it('starts at stage one with a 10% satellite cap', () => {
    const learning = computeLearningStage(base(), TODAY)
    expect(learning.stage).toBe(1)
    expect(learning.satelliteCapPercent).toBe(10)
    expect(effectivePolicy(base().investmentPolicy, learning).satellitePercent).toBe(10)
  })

  it('promotes to stage two after 12 macro months, 10 complete cards and discipline ≥ 75', () => {
    const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}-01`)
    const state = {
      ...base(),
      macroCheckIns: months.map(macro),
      stockTheses: Array.from({ length: 10 }, (_, i) => thesis(i)),
      trades: [trade({ checklist: [{ key: 'a', label: 'a', passed: true }] })],
    }
    const learning = computeLearningStage(state, TODAY)
    expect(learning.stage).toBe(2)
    expect(learning.satelliteCapPercent).toBe(20)
  })

  it('never exceeds the investment policy cap', () => {
    const s = base()
    const learning = computeLearningStage({ ...s, investmentPolicy: { ...s.investmentPolicy, satellitePercent: 5 } }, TODAY)
    expect(learning.satelliteCapPercent).toBe(5)
  })

  it('drops back a stage after three years of lagging the benchmark', () => {
    const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}-01`)
    const lagging = (year: number): PerformanceReview => ({
      id: `${year}`,
      periodStart: `${year}-01-01`,
      periodEnd: `${year}-12-31`,
      sleeves: [
        { sleeve: 'core_tw', startValue: 90, endValue: 99, netFlow: 0 },
        { sleeve: 'satellite_tw', startValue: 10, endValue: 10, netFlow: 0 },
      ],
      benchmarkReturns: { tw: 10, global: 10, bondCash: 0 },
      createdAt: '',
    })
    const state = {
      ...base(),
      macroCheckIns: months.map(macro),
      stockTheses: Array.from({ length: 10 }, (_, i) => thesis(i)),
      trades: [trade({ checklist: [{ key: 'a', label: 'a', passed: true }] })],
      performanceReviews: [2023, 2024, 2025].map(lagging),
    }
    const learning = computeLearningStage(state, TODAY)
    expect(learning.demoted).toBe(true)
    expect(learning.stage).toBe(1)
  })
})
