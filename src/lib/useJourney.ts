import { useAppStore } from './storage/appStore'
import {
  computeJourney,
  computeLearningStage,
  effectivePolicy,
  type JourneyState,
} from './calculations/journey'
import { todayIsoDate } from './market/twse'

// Action roadmap, learning stage and the stage-capped investment policy,
// derived from the stored data. Pages use `policy` (not the raw investment
// policy) wherever the satellite cap matters.
export function useJourney() {
  const profile = useAppStore((s) => s.profile)
  const assumptions = useAppStore((s) => s.assumptions)
  const monthlyRecords = useAppStore((s) => s.monthlyRecords)
  const foundation = useAppStore((s) => s.foundation)
  const investmentPolicy = useAppStore((s) => s.investmentPolicy)
  const holdings = useAppStore((s) => s.holdings)
  const trades = useAppStore((s) => s.trades)
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const stockTheses = useAppStore((s) => s.stockTheses)
  const performanceReviews = useAppStore((s) => s.performanceReviews)

  const state: JourneyState = {
    profile,
    assumptions,
    monthlyRecords,
    foundation,
    investmentPolicy,
    holdings,
    trades,
    macroCheckIns,
    stockTheses,
    performanceReviews,
  }
  const journey = computeJourney(state)
  const learning = computeLearningStage(state, todayIsoDate())
  return { state, journey, learning, policy: effectivePolicy(investmentPolicy, learning) }
}
