import { useEffect } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { usePlanningAssumptions } from '../lib/usePlanningAssumptions'
import { todayIsoDate } from '../lib/market/twse'

// Mounted once in the app shell: whenever the portfolio value changes it is
// recorded as this month's net-worth snapshot (and as the peak if higher).
export function PortfolioSnapshotRecorder() {
  const { fromPortfolio, portfolioValueTwd } = usePlanningAssumptions()
  const recordPortfolioValue = useAppStore((s) => s.recordPortfolioValue)

  useEffect(() => {
    if (fromPortfolio && portfolioValueTwd > 0) recordPortfolioValue(portfolioValueTwd, todayIsoDate())
  }, [fromPortfolio, portfolioValueTwd, recordPortfolioValue])

  return null
}
