import { describe, expect, it } from 'vitest'
import { computeFireProjection } from './fireProjection'
import type { FireAssumptions, UserProfile } from '../storage/schema'

const profile: UserProfile = {
  currentAge: 30,
  currency: 'TWD',
  updatedAt: new Date().toISOString(),
}

function assumptions(overrides: Partial<FireAssumptions> = {}): FireAssumptions {
  return {
    currentNetWorth: 1_000_000,
    monthlyIncome: 80_000,
    savingsMode: 'rate',
    savingsRatePercent: 30,
    monthlyExpenses: 40_000,
    expectedAnnualReturnPercent: 6,
    expectedInflationPercent: 2,
    safeWithdrawalRatePercent: 4,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('computeFireProjection', () => {
  it('computes the FIRE number as annual expenses over the withdrawal rate', () => {
    const result = computeFireProjection(profile, assumptions())
    expect(result.targetAnnualExpenses).toBe(40_000 * 12)
    expect(result.fireNumber).toBe((40_000 * 12) / 0.04)
  })

  it('reaches FIRE at a future date when contributions and growth are positive', () => {
    const result = computeFireProjection(profile, assumptions())
    expect(result.alreadyFire).toBe(false)
    expect(result.yearsToFire).not.toBeNull()
    expect(result.yearsToFire!).toBeGreaterThan(0)
    expect(result.targetDate).not.toBeNull()
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.projectedNetWorth).toBeGreaterThanOrEqual(result.fireNumber)
  })

  it('reports already-FIRE with zero years when starting above the FIRE number', () => {
    const result = computeFireProjection(profile, assumptions({ currentNetWorth: 50_000_000 }))
    expect(result.alreadyFire).toBe(true)
    expect(result.yearsToFire).toBe(0)
    expect(result.targetDate).toBe(new Date().toISOString().slice(0, 10))
  })

  it('never reaches FIRE when there is no growth and no contribution', () => {
    const result = computeFireProjection(
      profile,
      assumptions({
        currentNetWorth: 0,
        monthlyIncome: 0,
        savingsRatePercent: 0,
        expectedAnnualReturnPercent: 0,
        expectedInflationPercent: 0,
      }),
    )
    expect(result.yearsToFire).toBeNull()
    expect(result.targetDate).toBeNull()
    expect(result.alreadyFire).toBe(false)
  })

  it('treats a non-positive safe withdrawal rate as unreachable rather than dividing by zero', () => {
    const result = computeFireProjection(profile, assumptions({ safeWithdrawalRatePercent: 0 }))
    expect(result.fireNumber).toBe(Infinity)
    expect(result.yearsToFire).toBeNull()
    expect(Number.isNaN(result.points[0].projectedNetWorth)).toBe(false)
  })

  it('does not produce NaN when nominal return is a total loss (-100%)', () => {
    const result = computeFireProjection(
      profile,
      assumptions({ expectedAnnualReturnPercent: -100 }),
    )
    for (const point of result.points) {
      expect(Number.isNaN(point.projectedNetWorth)).toBe(false)
    }
  })
})
