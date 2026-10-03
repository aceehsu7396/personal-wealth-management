import { describe, expect, it } from 'vitest'
import { classifyRequiredReturn, computeRequiredReturn } from './requiredReturn'
import { computeFireProjection } from './fireProjection'
import type { FireAssumptions, UserProfile } from '../storage/schema'

const profile: UserProfile = {
  currentAge: 30,
  currency: 'TWD',
  updatedAt: new Date().toISOString(),
}

function assumptions(
  overrides: Partial<FireAssumptions> = {},
): FireAssumptions {
  return {
    currentNetWorth: 5_000_000,
    monthlyIncome: 150_000,
    savingsMode: 'rate',
    savingsRatePercent: 50,
    monthlyExpenses: 50_000,
    expectedAnnualReturnPercent: 6,
    expectedInflationPercent: 2,
    safeWithdrawalRatePercent: 4,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('computeRequiredReturn', () => {
  it('finds the lowest return that reaches FIRE within the target years', () => {
    const result = computeRequiredReturn(profile, assumptions(), 10)
    expect(result.requiredNominalReturnPercent).not.toBeNull()
    const required = result.requiredNominalReturnPercent!

    const atRequired = computeFireProjection(profile, {
      ...assumptions(),
      expectedAnnualReturnPercent: required,
    })
    expect(atRequired.yearsToFire!).toBeLessThanOrEqual(10)

    const justBelow = computeFireProjection(profile, {
      ...assumptions(),
      expectedAnnualReturnPercent: required - 0.1,
    })
    expect(justBelow.yearsToFire === null || justBelow.yearsToFire > 10).toBe(
      true,
    )
  })

  it('requires a higher return for a shorter horizon', () => {
    const ten = computeRequiredReturn(profile, assumptions(), 10)
    const seven = computeRequiredReturn(profile, assumptions(), 7)
    expect(seven.requiredNominalReturnPercent!).toBeGreaterThan(
      ten.requiredNominalReturnPercent!,
    )
  })

  it('reports already-FIRE when net worth exceeds the FIRE number', () => {
    const result = computeRequiredReturn(
      profile,
      assumptions({ currentNetWorth: 100_000_000 }),
      10,
    )
    expect(result.feasibility).toBe('already_fire')
    expect(result.requiredNominalReturnPercent).toBeNull()
  })

  it('reports unreachable when even the search ceiling is not enough', () => {
    const result = computeRequiredReturn(
      profile,
      assumptions({ currentNetWorth: 0, savingsRatePercent: 1 }),
      3,
    )
    expect(result.feasibility).toBe('unreachable')
  })

  it('reports unreachable when the withdrawal rate is zero', () => {
    const result = computeRequiredReturn(
      profile,
      assumptions({ safeWithdrawalRatePercent: 0 }),
      10,
    )
    expect(result.feasibility).toBe('unreachable')
  })
})

describe('classifyRequiredReturn', () => {
  it('maps return bands to feasibility labels', () => {
    expect(classifyRequiredReturn(5)).toBe('conservative')
    expect(classifyRequiredReturn(8)).toBe('reasonable')
    expect(classifyRequiredReturn(11)).toBe('aggressive')
    expect(classifyRequiredReturn(15)).toBe('unrealistic')
  })
})
