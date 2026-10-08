import { useAppStore } from '../lib/storage/appStore'
import { useJourney } from '../lib/useJourney'
import { analyzePortfolio } from '../lib/calculations/portfolioRisk'
import { PerformanceReviewPanel } from '../components/PerformanceReviewPanel'

export function PortfolioReviewPage() {
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  const guardrails = useAppStore((s) => s.guardrails)
  const meta = useAppStore((s) => s.portfolioMeta)
  const { policy } = useJourney()
  // Current sleeve values pre-fill the end of the review period.
  const report = analyzePortfolio(holdings, theses, policy, guardrails, meta)

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">績效歸因</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        每季一次：比較組合與「全部放在核心 ETF」的基準，拆成配置效果與選股效果，判斷報酬來自能力還是運氣（行動路線第五階段）。
      </p>
      <PerformanceReviewPanel report={report} />
    </div>
  )
}
