import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { computeFireProjection } from '../lib/calculations/fireProjection'
import { StrategyOverview } from '../components/StrategyOverview'
import { DailyScan } from '../components/trades/DailyScan'
import { useJourney } from '../lib/useJourney'
import { usePriceAutoRefresh } from '../lib/market/usePriceAutoRefresh'
import { usePlanningAssumptions } from '../lib/usePlanningAssumptions'
import { snapshotsAsCheckIns } from '../lib/calculations/netWorth'
import { ActualVsProjectedChart } from '../components/charts/ActualVsProjectedChart'

export function DashboardPage() {
  const profile = useAppStore((s) => s.profile)
  const snapshots = useAppStore((s) => s.portfolioSnapshots)
  // Holdings get the day's prices on the first visit, so net worth is current.
  usePriceAutoRefresh()
  // Net worth comes from the portfolio once holdings exist.
  const { assumptions } = usePlanningAssumptions()

  const result = computeFireProjection(profile, assumptions)
  const { journey } = useJourney()
  const nextStep = journey.nextStep

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">今日</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        財富自由計畫的整體現況：下一步、進度與策略紀律。
      </p>

      <div className="mt-6">
        <DailyScan />
      </div>

      {nextStep && (
        <div className="mt-6 rounded-lg border border-indigo-300 bg-indigo-50 p-5 dark:border-indigo-700 dark:bg-indigo-900/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-wide text-indigo-700 dark:text-indigo-300">
              下一步・行動路線 {journey.completedCount}/{journey.totalCount}
            </p>
            <Link to="/journey" className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
              查看完整路線
            </Link>
          </div>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {nextStep.id} {nextStep.title}
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{nextStep.detail}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link
              to={nextStep.page.to}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              前往{nextStep.page.label}
            </Link>
            <Link
              to={`/handbook/${nextStep.handbookSlug}`}
              className="rounded-md border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
            >
              先讀手冊這一章
            </Link>
          </div>
        </div>
      )}

      <StrategyOverview />

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            淨值進度
          </h2>
          <Link
            to="/portfolio"
            className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
          >
            前往持股與風控
          </Link>
        </div>
        <ActualVsProjectedChart
          projectedPoints={result.points}
          checkIns={snapshotsAsCheckIns(snapshots)}
          currency={profile.currency}
        />
      </div>

    </div>
  )
}
