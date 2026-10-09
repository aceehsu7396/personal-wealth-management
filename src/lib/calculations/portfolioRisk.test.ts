import { describe, expect, it } from 'vitest'
import { analyzePortfolio, holdingValueTwd } from './portfolioRisk'
import {
  createDefaultInvestmentPolicy,
  type AdviceGuardrails,
  type Holding,
  type PortfolioMeta,
  type StockThesis,
} from '../storage/schema'

const policy = createDefaultInvestmentPolicy()
const guardrails: AdviceGuardrails = {
  rebalancingBandPercent: 5,
  maxTiltPercent: 10,
  minEquityFloorPercent: 30,
  reviewCadenceMonths: 3,
}
const meta: PortfolioMeta = { fxUsdTwd: 30, peakValueTwd: 0, peakDate: null }

let seq = 0
function holding(overrides: Partial<Holding>): Holding {
  seq += 1
  return {
    id: `h${seq}`,
    ticker: `T${seq}`,
    name: '',
    sleeve: 'core_tw',
    currency: 'TWD',
    shares: 1,
    avgCost: 100,
    currentPrice: 100,
    createdAt: '',
    ...overrides,
  }
}

function thesis(overrides: Partial<StockThesis> = {}): StockThesis {
  return {
    id: 'th1',
    ticker: 'X',
    name: 'X',
    market: 'TW',
    sector: '半導體',
    lynchCategory: 'stalwart',
    inCircleOfCompetence: true,
    status: 'holding',
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
    fairValueBear: 80,
    fairValueBase: 120,
    fairValueBull: 150,
    currentPrice: 100,
    updatedAt: '',
    createdAt: '',
    ...overrides,
  }
}

// A 100,000 TWD portfolio with a 15% satellite and core sleeves sitting
// exactly on their rescaled targets (25/35/10 of the remaining 85%).
function balanced(): Holding[] {
  return [
    holding({ sleeve: 'core_tw', shares: 30_357 / 100 }),
    holding({ sleeve: 'core_global', currency: 'USD', shares: 42_500 / 30, currentPrice: 1 }),
    holding({ sleeve: 'core_bond_cash', shares: 12_143, currentPrice: 1, avgCost: 1 }),
    holding({ sleeve: 'satellite_tw', shares: 50, thesisId: 'th1' }),
    holding({ sleeve: 'satellite_tw', shares: 50, thesisId: 'th2' }),
    holding({ sleeve: 'satellite_us', currency: 'USD', shares: 5_000 / 30, currentPrice: 1, thesisId: 'th3' }),
  ]
}

describe('holdingValueTwd', () => {
  it('converts USD holdings at the FX rate', () => {
    expect(holdingValueTwd(holding({ currency: 'USD', shares: 10, currentPrice: 5 }), 30)).toBe(1500)
  })
})

describe('analyzePortfolio', () => {
  const theses = [thesis(), thesis({ id: 'th2', sector: '金融' }), thesis({ id: 'th3', market: 'US', sector: '軟體' })]

  it('reports no allocation violations for a balanced portfolio', () => {
    const report = analyzePortfolio(balanced(), theses, policy, guardrails, meta)
    expect(report.totalValueTwd).toBeCloseTo(100_000)
    expect(report.satellitePercent).toBeCloseTo(15)
    expect(report.violations.filter((v) => v.rule === '再平衡')).toHaveLength(0)
  })

  it('rescales core targets when the satellite is below its cap', () => {
    const report = analyzePortfolio(balanced(), theses, policy, guardrails, meta)
    const coreTw = report.sleeves.find((s) => s.sleeve === 'core_tw')!
    // 25 / 70 of the 85% that is not satellite
    expect(coreTw.effectiveTargetPercent).toBeCloseTo((25 / 70) * 85)
  })

  it('flags an oversized satellite position (exit rule ⑤)', () => {
    const holdings = [
      holding({ sleeve: 'core_tw', shares: 900 }),
      holding({ sleeve: 'satellite_tw', shares: 100, thesisId: 'th1' }),
    ]
    const report = analyzePortfolio(holdings, theses, policy, guardrails, meta)
    expect(report.violations.some((v) => v.rule.includes('⑤'))).toBe(true)
  })

  it('flags satellite holdings without a research card', () => {
    const holdings = [
      holding({ sleeve: 'core_tw', shares: 990 }),
      holding({ sleeve: 'satellite_tw', shares: 10 }),
    ]
    const report = analyzePortfolio(holdings, theses, policy, guardrails, meta)
    expect(report.violations.some((v) => v.rule === '研究紀律')).toBe(true)
  })

  it('requires a review after a deep drop from cost (exit rule ④)', () => {
    const holdings = [
      holding({ sleeve: 'core_tw', shares: 990 }),
      holding({ sleeve: 'satellite_tw', shares: 10, avgCost: 100, currentPrice: 70, thesisId: 'th1' }),
    ]
    const report = analyzePortfolio(holdings, theses, policy, guardrails, meta)
    expect(report.violations.some((v) => v.rule.includes('④'))).toBe(true)
  })

  it('flags sector concentration within the satellite', () => {
    // Satellite budget = 30% of 100,000; semiconductors hold 9,000 of it.
    const holdings = [
      holding({ sleeve: 'core_tw', shares: 900 }),
      holding({ sleeve: 'satellite_tw', shares: 90, thesisId: 'th1' }),
      holding({ sleeve: 'satellite_tw', shares: 10, thesisId: 'th2' }),
    ]
    const report = analyzePortfolio(holdings, theses, policy, guardrails, meta)
    expect(report.sectorExposure[0].sector).toBe('半導體')
    expect(report.sectorExposure[0].percentOfSatelliteBudget).toBeCloseTo(30)
    expect(report.violations.some((v) => v.rule === '產業集中度')).toBe(true)
  })

  it('does not flag the first satellite position for sector concentration', () => {
    const holdings = [
      holding({ sleeve: 'core_tw', shares: 970 }),
      holding({ sleeve: 'satellite_tw', shares: 30, thesisId: 'th1' }),
    ]
    const report = analyzePortfolio(holdings, theses, policy, guardrails, meta)
    expect(report.violations.some((v) => v.rule === '產業集中度')).toBe(false)
  })

  it('triggers the circuit breaker on a drawdown past the threshold', () => {
    const holdings = [holding({ sleeve: 'core_tw', shares: 750 })]
    const report = analyzePortfolio(holdings, theses, policy, guardrails, {
      ...meta,
      peakValueTwd: 100_000,
    })
    expect(report.drawdownPercent).toBeCloseTo(-25)
    expect(report.circuitBreakerActive).toBe(true)
    expect(report.violations[0].severity).toBe('critical')
  })

  it('flags USD exposure above the cap', () => {
    const holdings = [holding({ sleeve: 'core_global', currency: 'USD', shares: 100, currentPrice: 10 })]
    const report = analyzePortfolio(holdings, theses, policy, guardrails, meta)
    expect(report.usdExposurePercent).toBe(100)
    expect(report.violations.some((v) => v.rule === '匯率曝險')).toBe(true)
  })

  it('counts active funds toward the satellite without stock rules', () => {
    const holdings = [
      holding({ sleeve: 'core_tw', shares: 800 }),
      holding({ kind: 'fund', sleeve: 'satellite_fund', shares: 200, avgCost: 150, currentPrice: 100 }),
    ]
    const report = analyzePortfolio(holdings, theses, policy, guardrails, meta)
    expect(report.satellitePercent).toBeCloseTo(20)
    const fund = report.holdings.find((v) => v.holding.kind === 'fund')!
    expect(fund.positionCapPercent).toBeNull()
    const rules = report.violations.map((v) => v.rule)
    expect(rules).not.toContain('研究紀律')
    expect(rules.some((r) => r.includes('④') || r.includes('⑤'))).toBe(false)
    expect(report.sectorExposure).toEqual([])
  })

  it('reminds about high fund fees by sleeve', () => {
    const holdings = [
      holding({ kind: 'fund', sleeve: 'core_global', shares: 500, expenseRatioPercent: 1.2 }),
      holding({ kind: 'fund', sleeve: 'satellite_fund', shares: 100, expenseRatioPercent: 1.8 }),
      holding({ sleeve: 'core_tw', shares: 400 }),
    ]
    const fees = analyzePortfolio(holdings, theses, policy, guardrails, meta).violations.filter(
      (v) => v.rule === '基金費用',
    )
    expect(fees).toHaveLength(1)
    expect(fees[0].severity).toBe('info')
    expect(fees[0].message).toContain('1.2%')
  })

  it('returns an empty report for an empty portfolio', () => {
    const report = analyzePortfolio([], theses, policy, guardrails, meta)
    expect(report.totalValueTwd).toBe(0)
    expect(report.violations).toHaveLength(0)
  })
})
