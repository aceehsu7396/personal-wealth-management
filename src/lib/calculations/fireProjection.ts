import type { FireAssumptions, UserProfile } from '../storage/schema'

const MAX_MONTHS = 600 // 50-year projection horizon

export interface FireProjectionPoint {
  monthIndex: number
  year: number
  age: number
  projectedNetWorth: number
}

export interface FireProjectionResult {
  fireNumber: number
  targetAnnualExpenses: number
  points: FireProjectionPoint[]
  yearsToFire: number | null
  targetDate: string | null
  alreadyFire: boolean
}

function monthlyContributionOf(assumptions: FireAssumptions): number {
  if (assumptions.savingsMode === 'amount') {
    return assumptions.monthlySavingsAmount ?? 0
  }
  return ((assumptions.savingsRatePercent ?? 0) / 100) * assumptions.monthlyIncome
}

function realAnnualReturnOf(assumptions: FireAssumptions): number {
  const inflationFactor = 1 + assumptions.expectedInflationPercent / 100
  if (inflationFactor <= 0) return -1
  const nominalFactor = 1 + assumptions.expectedAnnualReturnPercent / 100
  const realReturn = nominalFactor / inflationFactor - 1
  return Math.max(realReturn, -1)
}

function pointAt(monthIndex: number, currentAge: number, netWorth: number): FireProjectionPoint {
  const now = new Date()
  return {
    monthIndex,
    year: now.getFullYear() + Math.floor(monthIndex / 12),
    age: currentAge + Math.floor(monthIndex / 12),
    projectedNetWorth: netWorth,
  }
}

export function computeFireProjection(
  profile: UserProfile,
  assumptions: FireAssumptions,
): FireProjectionResult {
  const targetAnnualExpenses =
    assumptions.targetAnnualExpensesOverride ?? assumptions.monthlyExpenses * 12

  if (assumptions.safeWithdrawalRatePercent <= 0) {
    return {
      fireNumber: Infinity,
      targetAnnualExpenses,
      points: [pointAt(0, profile.currentAge, assumptions.currentNetWorth)],
      yearsToFire: null,
      targetDate: null,
      alreadyFire: false,
    }
  }

  const fireNumber = targetAnnualExpenses / (assumptions.safeWithdrawalRatePercent / 100)
  const points: FireProjectionPoint[] = [pointAt(0, profile.currentAge, assumptions.currentNetWorth)]

  if (assumptions.currentNetWorth >= fireNumber) {
    return {
      fireNumber,
      targetAnnualExpenses,
      points,
      yearsToFire: 0,
      targetDate: new Date().toISOString().slice(0, 10),
      alreadyFire: true,
    }
  }

  const monthlyContribution = monthlyContributionOf(assumptions)
  const realMonthlyReturn = (1 + realAnnualReturnOf(assumptions)) ** (1 / 12) - 1

  let netWorth = assumptions.currentNetWorth
  let monthReached: number | null = null

  for (let month = 1; month <= MAX_MONTHS; month++) {
    netWorth = netWorth * (1 + realMonthlyReturn) + monthlyContribution

    if (month % 12 === 0) {
      points.push(pointAt(month, profile.currentAge, netWorth))
    }

    if (monthReached === null && netWorth >= fireNumber) {
      monthReached = month
      if (month % 12 !== 0) points.push(pointAt(month, profile.currentAge, netWorth))
      break
    }
  }

  if (monthReached === null) {
    return {
      fireNumber,
      targetAnnualExpenses,
      points,
      yearsToFire: null,
      targetDate: null,
      alreadyFire: false,
    }
  }

  const targetDate = new Date()
  targetDate.setMonth(targetDate.getMonth() + monthReached)

  return {
    fireNumber,
    targetAnnualExpenses,
    points,
    yearsToFire: monthReached / 12,
    targetDate: targetDate.toISOString().slice(0, 10),
    alreadyFire: false,
  }
}
