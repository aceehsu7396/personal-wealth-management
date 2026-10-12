import { useAppStore } from './storage/appStore'
import { usePlanningAssumptions } from './usePlanningAssumptions'
import { computeDiscipline } from './calculations/disciplineScore'
import { computeTraderReadiness } from './calculations/traderReadiness'
import { todayIsoDate } from './market/twse'

// Full-time readiness from the stored data (handbook chapter 11).
export function useTraderReadiness() {
  const { assumptions } = usePlanningAssumptions()
  const foundation = useAppStore((s) => s.foundation)
  const holdings = useAppStore((s) => s.holdings)
  const trades = useAppStore((s) => s.trades)
  const theses = useAppStore((s) => s.stockTheses)
  const performanceReviews = useAppStore((s) => s.performanceReviews)
  const policy = useAppStore((s) => s.investmentPolicy)
  const today = todayIsoDate()
  const discipline = computeDiscipline(trades, holdings, theses, policy, today)
  return computeTraderReadiness({
    assumptions,
    foundation,
    holdings,
    trades,
    performanceReviews,
    policy,
    disciplineScore: discipline.score,
    today,
  })
}
