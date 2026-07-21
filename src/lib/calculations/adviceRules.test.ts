import { describe, expect, it } from 'vitest'
import { computeAdvice, DISCLAIMER } from './adviceRules'
import type { AdviceGuardrails, MarketCheckIn, ValuationZone } from '../storage/schema'

const guardrails: AdviceGuardrails = {
  rebalancingBandPercent: 5,
  maxTiltPercent: 10,
  minEquityFloorPercent: 30,
  reviewCadenceMonths: 3,
}

function checkIn(valuationZone: ValuationZone): MarketCheckIn {
  return {
    id: 'test-id',
    date: '2026-07-21',
    marketPhase: 'sideways',
    valuationZone,
    interestRateLevel: 'neutral',
    createdAt: new Date().toISOString(),
  }
}

describe('computeAdvice', () => {
  it('always attaches the fixed long-term disclaimer', () => {
    const result = computeAdvice(checkIn('fair'), guardrails)
    expect(result.disclaimer).toBe(DISCLAIMER)
  })

  it('keeps the standard rebalancing band and no tilt when fairly valued', () => {
    const result = computeAdvice(checkIn('fair'), guardrails)
    expect(result.rebalancingSuggestion).toContain('±5.0%')
    expect(result.allocationTiltSuggestion).toContain('不做方向性調整')
  })

  it('tilts toward equities and keeps a standard band when undervalued', () => {
    const result = computeAdvice(checkIn('undervalued'), guardrails)
    expect(result.rebalancingSuggestion).toContain('±5.0%')
    expect(result.allocationTiltSuggestion).toContain('上調股票配置')
    expect(result.allocationTiltSuggestion).toContain('+10')
  })

  it('tightens the band and tilts toward bonds/cash when overvalued', () => {
    const result = computeAdvice(checkIn('overvalued'), guardrails)
    expect(result.rebalancingSuggestion).toContain('收緊')
    expect(result.rebalancingSuggestion).toContain('±3.0%')
    expect(result.allocationTiltSuggestion).toContain('下調股票配置')
    expect(result.allocationTiltSuggestion).toContain('-10')
  })

  it('caps the tilt at the equity floor when extremely overvalued', () => {
    const result = computeAdvice(checkIn('extremely_overvalued'), guardrails)
    expect(result.rebalancingSuggestion).toContain('收緊')
    expect(result.allocationTiltSuggestion).toContain('下限 30%')
  })

  it('never recommends stopping dollar-cost averaging regardless of valuation', () => {
    const zones: ValuationZone[] = [
      'undervalued',
      'fair',
      'overvalued',
      'extremely_overvalued',
      'unsure',
    ]
    for (const zone of zones) {
      const result = computeAdvice(checkIn(zone), guardrails)
      expect(result.dcaPacingSuggestion).toContain('維持既定定期定額')
    }
  })
})
