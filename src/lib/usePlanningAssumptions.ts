import { useAppStore } from './storage/appStore'
import { planningAssumptions } from './calculations/netWorth'

// FIRE inputs with current net worth taken from the portfolio once holdings
// exist. Every page that projects or reverse-solves FIRE uses this.
export function usePlanningAssumptions() {
  const assumptions = useAppStore((s) => s.assumptions)
  const holdings = useAppStore((s) => s.holdings)
  const fxUsdTwd = useAppStore((s) => s.portfolioMeta.fxUsdTwd)
  return planningAssumptions(assumptions, holdings, fxUsdTwd)
}
