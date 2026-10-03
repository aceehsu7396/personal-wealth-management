import type { FireAssumptions, UserProfile } from '../storage/schema'
import { computeFireProjection } from './fireProjection'

export type ReturnFeasibility =
  | 'already_fire'
  | 'conservative'
  | 'reasonable'
  | 'aggressive'
  | 'unrealistic'
  | 'unreachable'

export interface RequiredReturnResult {
  requiredNominalReturnPercent: number | null
  feasibility: ReturnFeasibility
}

// Search bounds for the nominal annual return. Anything above the upper bound
// is treated as unreachable rather than a meaningful target.
const MIN_RETURN_PERCENT = -20
const MAX_RETURN_PERCENT = 40
const PRECISION_PERCENT = 0.01

export const FEASIBILITY_LABELS: Record<ReturnFeasibility, string> = {
  already_fire: '已達成目標',
  conservative: '保守：核心 ETF 即可達成',
  reasonable: '合理：接近全球股市長期報酬',
  aggressive: '積極：需要衛星持續產生超額報酬',
  unrealistic: '不切實際：應優先調整儲蓄、年限或支出',
  unreachable: '無法達成：請調整儲蓄、年限或支出',
}

function reachesWithin(
  profile: UserProfile,
  assumptions: FireAssumptions,
  returnPercent: number,
  targetYears: number,
): boolean {
  const result = computeFireProjection(profile, {
    ...assumptions,
    expectedAnnualReturnPercent: returnPercent,
  })
  return result.yearsToFire !== null && result.yearsToFire <= targetYears
}

export function classifyRequiredReturn(
  returnPercent: number,
): ReturnFeasibility {
  if (returnPercent <= 6) return 'conservative'
  if (returnPercent <= 9) return 'reasonable'
  if (returnPercent <= 12) return 'aggressive'
  return 'unrealistic'
}

// Reverse-solves the FIRE projection: the lowest nominal annual return that
// reaches the FIRE number within targetYears, given current savings inputs.
export function computeRequiredReturn(
  profile: UserProfile,
  assumptions: FireAssumptions,
  targetYears: number,
): RequiredReturnResult {
  const baseline = computeFireProjection(profile, assumptions)
  if (baseline.alreadyFire) {
    return { requiredNominalReturnPercent: null, feasibility: 'already_fire' }
  }

  if (!reachesWithin(profile, assumptions, MAX_RETURN_PERCENT, targetYears)) {
    return { requiredNominalReturnPercent: null, feasibility: 'unreachable' }
  }

  let low = MIN_RETURN_PERCENT
  let high = MAX_RETURN_PERCENT
  if (reachesWithin(profile, assumptions, low, targetYears)) {
    return { requiredNominalReturnPercent: low, feasibility: 'conservative' }
  }

  while (high - low > PRECISION_PERCENT) {
    const mid = (low + high) / 2
    if (reachesWithin(profile, assumptions, mid, targetYears)) high = mid
    else low = mid
  }

  const required = Math.round(high * 100) / 100
  return {
    requiredNominalReturnPercent: required,
    feasibility: classifyRequiredReturn(required),
  }
}
