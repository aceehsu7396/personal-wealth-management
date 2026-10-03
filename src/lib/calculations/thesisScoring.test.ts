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
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('evaluateThesis', () => {
  it('gives high-quality names a thinner margin of safety', () => {
    const result = evaluateThesis(thesis(), policy)
    expect(result.qualityTier).toBe('high')
    expect(result.marginOfSafetyPercent).toBe(15)
    expect(result.buyPrice).toBeCloseTo(1020)
  })

  it('gives cyclicals a thicker margin of safety and a lower cap', () => {
    const result = evaluateThesis(thesis({ lynchCategory: 'cyclical' }), policy)
    expect(result.qualityTier).toBe('cyclical')
    expect(result.marginOfSafetyPercent).toBe(35)
    expect(result.positionCapPercent).toBe(3)
  })

  it('respects an explicit margin-of-safety override', () => {
    const result = evaluateThesis(thesis({ marginOfSafetyOverridePercent: 40 }), policy)
    expect(result.marginOfSafetyPercent).toBe(40)
    expect(result.buyPrice).toBeCloseTo(720)
  })

  it('passes every check for a complete, cheap, high-quality thesis', () => {
    const result = evaluateThesis(thesis(), policy)
    expect(result.priceZone).toBe('buy')
    expect(result.upsideDownsideRatio).toBeCloseTo(650 / 250)
    expect(result.passesAll).toBe(true)
  })

  it('fails completeness when the kill criteria are blank', () => {
    const result = evaluateThesis(thesis({ killCriteria: '  ' }), policy)
    expect(result.isComplete).toBe(false)
    expect(result.passesAll).toBe(false)
    expect(result.checks.find((c) => c.key === 'complete')?.passed).toBe(false)
  })

  it('lowers the quality score when ROIC misses the hurdle or red flags exist', () => {
    const clean = evaluateThesis(thesis(), policy)
    const weak = evaluateThesis(thesis({ roicPercent: 10, hasUnexplainedRedFlags: true }), policy)
    expect(weak.qualityScore).toBeCloseTo(clean.qualityScore - 2)
    expect(weak.checks.find((c) => c.key === 'roic')?.passed).toBe(false)
  })

  it('flags implied growth that runs ahead of history', () => {
    const result = evaluateThesis(
      thesis({ impliedGrowthPercent: 20, historicalGrowthPercent: 12 }),
      policy,
    )
    expect(result.checks.find((c) => c.key === 'impliedGrowth')?.passed).toBe(false)
  })

  it('computes the probability-weighted expected value', () => {
    const result = evaluateThesis(thesis(), policy)
    expect(result.expectedValue).toBeCloseTo(700 * 0.25 + 1200 * 0.5 + 1600 * 0.25)
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
