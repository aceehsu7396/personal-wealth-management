import { describe, expect, it } from 'vitest'
import {
  evaluateThesis,
  positionCapFor,
  priceZoneOf,
  targetPositionPercentOf,
  upsideDownsideRatioOf,
} from './thesisScoring'
import { createDefaultInvestmentPolicy, type StockThesis } from '../storage/schema'

const policy = createDefaultInvestmentPolicy()

function thesis(overrides: Partial<StockThesis> = {}): StockThesis {
  return {
    id: 't1',
    ticker: '2330',
    name: '台積電',
    market: 'TW',
    sector: '半導體',
    lynchCategory: 'stalwart',
    inCircleOfCompetence: true,
    status: 'watch',
    thesis: '先進製程領先',
    drivers: 'AI 需求、先進封裝、定價能力',
    killCriteria: '連續 2 季毛利率 < 50%',
    sources: '法說會、供應鏈訪談、產業報告',
    preMortem: '地緣政治衝突導致產能中斷',
    fiveForces: { rivalry: 4, newEntrants: 5, substitutes: 4, buyerPower: 3, supplierPower: 3 },
    powers: {
      scaleEconomies: 5,
      networkEconomies: 0,
      counterPositioning: 0,
      switchingCosts: 4,
      branding: 2,
      corneredResource: 0,
      processPower: 5,
    },
    fScore: 8,
    roicPercent: 25,
    waccPercent: 9,
    hasUnexplainedRedFlags: false,
    fairValueBear: 700,
    fairValueBase: 1200,
    fairValueBull: 1600,
    currentPrice: 950,
    kind: 'stock',
    verdict: 'invest',
    verdictNote: '',
    explainedFlags: {},
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// An automatic health check: high quality, growing, safe, no red flags.
function stockAuto(overrides: Record<string, unknown> = {}) {
  return {
    fetchedAt: '2026-10-23T00:00:00Z',
    kind: 'stock' as const,
    name: '台積電',
    industry: '半導體業',
    price: 950,
    priceDate: '2026-10-22',
    etf: null,
    stock: {
      asOf: '2026-06-30',
      isFinancial: false,
      epsTtm: 50,
      epsTtmPrev: 40,
      roe: 25,
      grossMargin: 55,
      grossMarginPrev: 53,
      operatingMargin: 40,
      revenueCagr3y: 15,
      epsCagr3y: 18,
      revenueYoyTtm: 20,
      debtRatio: 30,
      currentRatio: 2,
      freeCashFlow: [{ year: '2025', value: 1 }],
      fScore: { score: 8, items: [] },
      redFlags: [],
      dividends: { consecutiveYears: 10, lastYearCash: 10, payoutRatio: 20 },
      valuation: { pe: { current: 19, p20: 14, p50: 24, p80: 32, percentile: 30 }, pb: null, dividendYield: 1, years: 5 },
      lynch: 'stalwart' as const,
      ...overrides,
    },
  }
}

describe('evaluateThesis', () => {
  const withAuto = (o: Partial<StockThesis> = {}, a: Record<string, unknown> = {}) => thesis({ auto: stockAuto(a) as never, ...o })
  const keys = (t: StockThesis) => Object.fromEntries(evaluateThesis(t, policy).checks.map((c) => [c.key, c.passed]))

  it('passes every check for a cheap, high-quality stock the user rates "invest"', () => {
    const result = evaluateThesis(withAuto(), policy)
    expect(result.qualityTier).toBe('high')
    expect(result.marginOfSafetyPercent).toBe(15)
    expect(result.buyPrice).toBeCloseTo(1020)
    expect(result.priceZone).toBe('buy')
    expect(result.upsideDownsideRatio).toBeCloseTo(650 / 250)
    expect(result.checks.map((c) => c.key)).toEqual(['verdict', 'fScore', 'roe', 'redFlags', 'price', 'asymmetry'])
    expect(result.passesAll).toBe(true)
    expect(result.isComplete).toBe(true)
  })

  it('derives conviction from the rating and uses the automatic Lynch category', () => {
    const result = evaluateThesis(withAuto({ lynchCategory: 'slow_grower' }, { lynch: 'cyclical' }), policy)
    expect(result.lynchCategory).toBe('cyclical')
    expect(result.qualityTier).toBe('cyclical')
    expect(result.marginOfSafetyPercent).toBe(35)
    expect(result.positionCapPercent).toBe(3)
    expect(evaluateThesis(withAuto(), policy).convictionScore).toBe(5)
  })

  it('needs a verdict to be complete, and "invest" to pass', () => {
    expect(evaluateThesis(withAuto({ verdict: undefined }), policy).isComplete).toBe(false)
    expect(keys(withAuto({ verdict: 'watch' })).verdict).toBe(false)
  })

  it('fails on red flags, a weak F-score or ROE, and skips the F-score for financials', () => {
    expect(keys(withAuto({}, { redFlags: [{ key: 'loss', label: '近四季虧損', detail: '' }] })).redFlags).toBe(false)
    expect(keys(withAuto({}, { fScore: { score: 4, items: [] }, roe: 8 }))).toMatchObject({ fScore: false, roe: false })
    expect(keys(withAuto({}, { fScore: null, isFinancial: true })).fScore).toBeUndefined()
  })

  it('cannot pass without automatic data', () => {
    const e = evaluateThesis(thesis({ market: 'US', auto: undefined }), policy)
    expect(e.checks.map((c) => c.key)).toEqual(['auto', 'verdict'])
    expect(e.isComplete).toBe(false)
  })

  it('judges ETF cards on the verdict and liquidity, without a price zone', () => {
    const etf = thesis({ kind: 'etf', auto: { kind: 'etf', etf: { avgTradeValue: 0.2, returns: {}, distributionYears: 0, maxDrawdown: -10 } } as never })
    const e = evaluateThesis(etf, policy)
    expect(e.priceZone).toBe('hold')
    expect(Object.fromEntries(e.checks.map((c) => [c.key, c.passed]))).toEqual({ verdict: true, liquidity: false })
  })

  it('computes the probability-weighted expected value', () => {
    expect(evaluateThesis(withAuto(), policy).expectedValue).toBeCloseTo(700 * 0.25 + 1200 * 0.5 + 1600 * 0.25)
  })
})

describe('priceZoneOf', () => {
  it('walks from strong buy to exit as price rises', () => {
    expect(priceZoneOf(600, 700, 1000, 1600)).toBe('strong_buy')
    expect(priceZoneOf(900, 700, 1000, 1600)).toBe('buy')
    expect(priceZoneOf(1300, 700, 1000, 1600)).toBe('hold')
    expect(priceZoneOf(1800, 700, 1000, 1600)).toBe('trim')
    expect(priceZoneOf(2000, 700, 1000, 1600)).toBe('exit_overvalued')
  })
})

describe('upsideDownsideRatioOf', () => {
  it('is infinite at or below the bear case', () => {
    expect(upsideDownsideRatioOf(700, 700, 1600)).toBe(Infinity)
  })

  it('is negative above the bull case', () => {
    expect(upsideDownsideRatioOf(1700, 700, 1600)).toBeLessThan(0)
  })
})

describe('positionCapFor', () => {
  it('uses the high-conviction cap only for conviction ≥ 4', () => {
    expect(positionCapFor('stalwart', 4.2, policy)).toBe(8)
    expect(positionCapFor('stalwart', 3.5, policy)).toBe(5)
    expect(positionCapFor('turnaround', 5, policy)).toBe(2)
  })
})

describe('targetPositionPercentOf', () => {
  it('scales the 3% base by conviction and asymmetry, then caps it', () => {
    expect(targetPositionPercentOf(4, 3, 8)).toBe(6)
    expect(targetPositionPercentOf(5, 10, 8)).toBe(7.5)
    expect(targetPositionPercentOf(5, Infinity, 5)).toBe(5)
    expect(targetPositionPercentOf(3, 2, 5)).toBe(3)
  })

  it('is zero when there is no upside', () => {
    expect(targetPositionPercentOf(5, -0.5, 8)).toBe(0)
  })
})
