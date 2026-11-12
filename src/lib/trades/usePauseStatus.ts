import { useMemo } from 'react'
import { useAppStore } from '../storage/appStore'
import { useJourney } from '../useJourney'
import { analyzePortfolio } from '../calculations/portfolioRisk'
import { pauseStatus, type PauseStatus } from '../calculations/tradingPause'
import { todayIsoDate } from '../market/twse'

// The trading sleeve's pause rules, measured against its budget (the
// policy share of the whole portfolio).
export function usePauseStatus(): PauseStatus {
  const trades = useAppStore((s) => s.trades)
  const reviews = useAppStore((s) => s.pauseReviews)
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  const guardrails = useAppStore((s) => s.guardrails)
  const meta = useAppStore((s) => s.portfolioMeta)
  const { policy } = useJourney()
  return useMemo(() => {
    const total = analyzePortfolio(holdings, theses, policy, guardrails, meta).totalValueTwd
    return pauseStatus({ trades, reviews, policy, satelliteValueTwd: (total * policy.satellitePercent) / 100, fxUsdTwd: meta.fxUsdTwd, today: todayIsoDate() })
  }, [trades, reviews, holdings, theses, policy, guardrails, meta])
}
