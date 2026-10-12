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
  type BacktestRun,
  type BacktestStats,
  type Holding,
  type PaperAccount,
  type TradingStrategy,
  type MacroCheckIn,
  type PerformanceReview,
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
    foundation: { emergencyFundAmount: 0, emergencyFundTargetMonths: 6, livingBufferMonths: 24 },
    investmentPolicy: d.investmentPolicy,
    holdings: [],
    trades: [],
    macroCheckIns: [],
    stockTheses: [],
    performanceReviews: [],
    tradingStrategies: [],
    backtestRuns: [],
    paperAccounts: [],
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

function stats(cagr: number): BacktestStats {
  return { totalReturn: cagr, cagr, maxDrawdown: -0.1, sharpe: 1, trades: 10, winRate: 0.5, profitFactor: 1.5, exposure: 0.6 }
}

function run(strategyCagr: number, benchmarkCagr: number): BacktestRun {
  return {
    id: `r${strategyCagr}`,
    label: '',
    template: 'ma_cross',
    params: {},
    symbols: ['TW:0050'],
    start: '2020-01-01',
    end: '2026-01-01',
    initialCapital: 1_000_000,
    outOfSampleStart: '2024-03-01',
    dividendAdjusted: true,
    stats: { full: stats(strategyCagr), inSample: stats(strategyCagr), outOfSample: stats(strategyCagr) },
    benchmark: { full: stats(benchmarkCagr), inSample: stats(benchmarkCagr), outOfSample: stats(benchmarkCagr) },
    equity: [],
    createdAt: '',
  }
}

const strategy: TradingStrategy = {
  id: 'st',
  name: '0050 均線',
  template: 'ma_cross',
  params: {},
  symbols: ['TW:0050'],
  edge: '',
  entryRules: '',
  exitRules: '',
  riskPerTradePercent: 1,
  status: 'paper',
  notes: '',
  createdAt: '',
  updatedAt: '',
}

function paper(fills: number, firstFill: string): PaperAccount {
  return {
    id: 'pa',
    name: '',
    strategyId: 'st',
    market: 'TW',
    initialCash: 1_000_000,
    cash: 1_000_000,
    positions: [],
    orders: Array.from({ length: fills }, (_, i) => ({
      id: `o${i}`,
      createdAt: firstFill,
      symbol: 'TW:0050',
      name: '',
      side: 'buy' as const,
      type: 'market' as const,
      shares: 1,
      status: 'filled' as const,
      filledAt: firstFill,
      fillPrice: 100,
      reason: '',
    })),
    equityHistory: [],
    createdAt: '',
  }
}

// A learner who has finished every satellite prerequisite.
function readyForSatellite(): JourneyState {
  const s = base()
  return {
    ...s,
    tradingStrategies: [strategy],
    backtestRuns: [run(0.12, 0.08)],
    paperAccounts: [paper(10, '2026-06-01')],
    foundation: { emergencyFundAmount: 300_000, emergencyFundTargetMonths: 6, livingBufferMonths: 24 },
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

  it('sets the emergency fund target from monthly expenses × target months', () => {
    expect(emergencyFundTarget(base())).toBe(300_000)
  })
})

describe('computeJourney', () => {
  it('starts a new user at step 1.1 with satellite locked', () => {
    const fresh = { ...base(), assumptions: createDefaultAppData().assumptions }
    const report = computeJourney(fresh, TODAY)
    expect(report.nextStep?.id).toBe('1.1')
    expect(report.satelliteUnlocked).toBe(false)
    expect(report.missingForSatellite.map((s) => s.id)).toEqual(['1.1', '1.2', '1.4', '2.1', '2.3', '3.1', '4.2', '4.3'])
  })

  it('requires the emergency fund to cover the target months of spending', () => {
    const short = computeJourney({ ...base(), foundation: { emergencyFundAmount: 299_999, emergencyFundTargetMonths: 6, livingBufferMonths: 24 } }, TODAY)
    const full = computeJourney({ ...base(), foundation: { emergencyFundAmount: 300_000, emergencyFundTargetMonths: 6, livingBufferMonths: 24 } }, TODAY)
    const step = (r: typeof short) => r.stages[0].steps.find((s) => s.id === '1.2')!
    expect(step(short).done).toBe(false)
    expect(step(full).done).toBe(true)
  })

  it('counts DCA and macro months by distinct calendar month', () => {
    const s = readyForSatellite()
    const sameMonth = computeJourney(
      { ...s, trades: ['2026-09-01', '2026-09-15', '2026-09-28'].map((date) => trade({ date })) },
      TODAY,
    )
    expect(sameMonth.stages[1].steps.find((x) => x.id === '2.3')!.done).toBe(false)
    expect(computeJourney(s, TODAY).stages[1].steps.find((x) => x.id === '2.3')!.done).toBe(true)
  })

  it('unlocks satellite once every prerequisite is done', () => {
    const report = computeJourney(readyForSatellite(), TODAY)
    expect(report.satelliteUnlocked).toBe(true)
    expect(report.missingForSatellite).toEqual([])
    // 3.2 (three macro months) is not a prerequisite, so it is the next step.
    expect(report.nextStep?.id).toBe('3.2')
  })

  it('needs an out-of-sample win and enough paper trading to unlock', () => {
    const s = readyForSatellite()
    const losing = computeJourney({ ...s, backtestRuns: [run(0.05, 0.08)] }, TODAY)
    expect(losing.missingForSatellite.map((x) => x.id)).toEqual(['4.2'])
    const tooShort = computeJourney({ ...s, paperAccounts: [paper(10, '2026-09-01')] }, TODAY)
    expect(tooShort.missingForSatellite.map((x) => x.id)).toEqual(['4.3'])
    const tooFew = computeJourney({ ...s, paperAccounts: [paper(9, '2026-06-01')] }, TODAY)
    expect(tooFew.missingForSatellite.map((x) => x.id)).toEqual(['4.3'])
  })

  it('counts the first real trade only with a strategy card and a stop', () => {
    const s = readyForSatellite()
    const step = (trades: Trade[]) =>
      computeJourney({ ...s, holdings: [...s.holdings, holding('sat', 'satellite_tw')], trades: [...s.trades, ...trades] }, TODAY)
        .stages[4].steps.find((x) => x.id === '5.1')!.done
    expect(step([trade({ reason: 'tranche_1', holdingId: 'sat' })])).toBe(false)
    expect(step([trade({ reason: 'strategy_entry', holdingId: 'sat', strategyId: 'st', stopLoss: 0.9 })])).toBe(true)
  })
})

describe('computeLearningStage', () => {
  it('starts at stage one with a 10% satellite cap', () => {
    const learning = computeLearningStage(base(), TODAY)
    expect(learning.stage).toBe(1)
    expect(learning.satelliteCapPercent).toBe(10)
    expect(effectivePolicy(base().investmentPolicy, learning).satellitePercent).toBe(10)
  })

  it('promotes to stage two after 12 macro months, discipline ≥ 75 and a paper-proven strategy', () => {
    const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}-01`)
    const state = {
      ...base(),
      macroCheckIns: months.map(macro),
      tradingStrategies: [strategy],
      paperAccounts: [paper(10, '2026-06-01')],
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
      tradingStrategies: [strategy],
      paperAccounts: [paper(10, '2026-06-01')],
      trades: [trade({ checklist: [{ key: 'a', label: 'a', passed: true }] })],
      performanceReviews: [2023, 2024, 2025].map(lagging),
    }
    const learning = computeLearningStage(state, TODAY)
    expect(learning.demoted).toBe(true)
    expect(learning.stage).toBe(1)
  })
})
