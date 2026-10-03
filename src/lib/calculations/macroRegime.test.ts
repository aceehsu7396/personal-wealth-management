import { describe, expect, it } from 'vitest'
import {
  assessMacro,
  classifyRegime,
  classifyStance,
  formatTiltRange,
  majorityDirection,
} from './macroRegime'
import type { AdviceGuardrails, MacroCheckIn } from '../storage/schema'

const guardrails: AdviceGuardrails = {
  rebalancingBandPercent: 5,
  maxTiltPercent: 10,
  minEquityFloorPercent: 30,
  reviewCadenceMonths: 3,
}

function checkIn(overrides: Partial<MacroCheckIn> = {}): MacroCheckIn {
  return {
    id: 'm1',
    date: '2026-10-01',
    growth: { usPmi: 'up', usEmployment: 'up', twBusinessSignal: 'up', twExportOrders: 'flat' },
    inflation: { usCpi: 'down', twCpi: 'flat' },
    liquidity: {
      policyRate: 1,
      yieldCurve: 1,
      creditSpread: 1,
      centralBankBalanceSheet: 0,
      usDollar: 0,
    },
    sentiment: { valuation: 0, credit: 0, ipoHype: 0, media: 0, margin: 0, vix: 0 },
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('majorityDirection', () => {
  it('needs at least half the indicators and more than the opposite side', () => {
    expect(majorityDirection(['up', 'up', 'down', 'flat'])).toBe('up')
    expect(majorityDirection(['up', 'down', 'flat', 'flat'])).toBe('flat')
    expect(majorityDirection(['up', 'up', 'down', 'down'])).toBe('flat')
    expect(majorityDirection(['down', 'flat'])).toBe('down')
  })
})

describe('classifyRegime', () => {
  it('maps growth and inflation directions to quadrants', () => {
    expect(classifyRegime('up', 'down')).toBe('goldilocks')
    expect(classifyRegime('up', 'flat')).toBe('goldilocks')
    expect(classifyRegime('up', 'up')).toBe('overheat')
    expect(classifyRegime('down', 'up')).toBe('stagflation')
    expect(classifyRegime('down', 'down')).toBe('recession')
    expect(classifyRegime('flat', 'up')).toBe('mixed')
  })
})

describe('classifyStance', () => {
  it('lets extreme fear override the regime', () => {
    expect(classifyStance('recession', -3, -4)).toBe('panic_opportunity')
  })

  it('requires aligned pillars for strong stances', () => {
    expect(classifyStance('goldilocks', 2, 0)).toBe('strong_tailwind')
    expect(classifyStance('goldilocks', 2, 1)).toBe('tailwind')
    expect(classifyStance('stagflation', -2, 3)).toBe('strong_headwind')
    expect(classifyStance('stagflation', -2, 2)).toBe('headwind')
  })

  it('treats tight liquidity alone as a headwind', () => {
    expect(classifyStance('mixed', -2, 0)).toBe('headwind')
  })

  it('falls back to neutral when signals are mixed', () => {
    expect(classifyStance('mixed', 1, 0)).toBe('neutral')
    expect(classifyStance('overheat', -1, 0)).toBe('neutral')
  })
})

describe('assessMacro', () => {
  it('produces a strong tailwind with a tilt capped by guardrails', () => {
    const result = assessMacro(checkIn(), guardrails)
    expect(result.regime).toBe('goldilocks')
    expect(result.liquidityScore).toBe(3)
    expect(result.stance).toBe('strong_tailwind')
    expect(result.tiltMinPoints).toBe(5)
    expect(result.tiltMaxPoints).toBe(10)
    expect(result.satelliteNewPositionsAllowed).toBe(true)
  })

  it('blocks new satellite positions in a headwind', () => {
    const result = assessMacro(
      checkIn({
        growth: { usPmi: 'down', usEmployment: 'down', twBusinessSignal: 'down', twExportOrders: 'flat' },
        inflation: { usCpi: 'up', twCpi: 'up' },
      }),
      guardrails,
    )
    expect(result.regime).toBe('stagflation')
    expect(result.stance).toBe('headwind')
    expect(result.tiltMaxPoints).toBe(-5)
    expect(result.satelliteNewPositionsAllowed).toBe(false)
  })
})

describe('formatTiltRange', () => {
  it('formats ranges, single values and zero', () => {
    expect(formatTiltRange(5, 10)).toBe('+5 ～ +10 個百分點')
    expect(formatTiltRange(-5, -5)).toBe('-5 個百分點')
    expect(formatTiltRange(0, 0)).toBe('0（維持策略配置）')
  })
})
