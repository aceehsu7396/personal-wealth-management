import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { computeFireProjection } from '../lib/calculations/fireProjection'
import { computeProgressPercent } from '../lib/calculations/progress'
import { computeAdvice } from '../lib/calculations/adviceRules'
import { computeNetCashFlow } from '../lib/calculations/netCashFlow'
import { isReviewDue } from '../lib/reviewSchedule'
import { StatCard } from '../components/StatCard'
import { AdviceSummary } from '../components/AdviceSummary'
import { StrategyOverview } from '../components/StrategyOverview'
import { useJourney } from '../lib/useJourney'
import { ActualVsProjectedChart } from '../components/charts/ActualVsProjectedChart'
import { formatCurrency, formatDate, formatYearsToFire } from '../lib/format'

export function DashboardPage() {
  const profile = useAppStore((s) => s.profile)
  const assumptions = useAppStore((s) => s.assumptions)
  const checkIns = useAppStore((s) => s.checkIns)
  const marketCheckIns = useAppStore((s) => s.marketCheckIns)
  const monthlyRecords = useAppStore((s) => s.monthlyRecords)
  const guardrails = useAppStore((s) => s.guardrails)

  const result = computeFireProjection(profile, assumptions)

  const sortedCheckIns = [...checkIns].sort((a, b) => b.date.localeCompare(a.date))
  const latestCheckIn = sortedCheckIns[0]
  const latestNetWorth = latestCheckIn ? latestCheckIn.netWorthAmount : assumptions.currentNetWorth
  const progressPercent = computeProgressPercent(latestNetWorth, result.fireNumber)

  const sortedMarketCheckIns = [...marketCheckIns].sort((a, b) => b.date.localeCompare(a.date))
  const latestMarketCheckIn = sortedMarketCheckIns[0]
  const advice = latestMarketCheckIn ? computeAdvice(latestMarketCheckIn, guardrails) : null
  const reviewDue = isReviewDue(latestMarketCheckIn?.date, guardrails.reviewCadenceMonths)

  const currentMonth = new Date().toISOString().slice(0, 7)
  const currentMonthRecord = monthlyRecords.find((r) => r.month === currentMonth)
  const currentMonthNetCashFlow = currentMonthRecord
    ? computeNetCashFlow(currentMonthRecord).netCashFlow
    : null

  const progressStat = result.alreadyFire
    ? '已達成財富自由'
    : result.yearsToFire === null
      ? '50 年內無法達成'
      : `約 ${formatYearsToFire(result.yearsToFire)}`

  const { journey } = useJourney()
  const nextStep = journey.nextStep

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">儀表板</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        財富自由計畫的整體現況一覽。
      </p>

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

      {latestMarketCheckIn && reviewDue && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
          <span>
            {latestMarketCheckIn
              ? `距離上次市場檢視已超過 ${guardrails.reviewCadenceMonths} 個月，該做下一次評估了。`
              : '還沒有任何市場評估，建議新增第一筆。'}
          </span>
          <Link to="/market" className="whitespace-nowrap font-medium underline">
            前往市場檢視
          </Link>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="最新淨值"
          value={formatCurrency(latestNetWorth, profile.currency)}
          hint={latestCheckIn ? `紀錄於 ${latestCheckIn.date}` : '尚無進度紀錄'}
        />
        <StatCard
          label="達成進度"
          value={progressPercent !== null ? `${progressPercent.toFixed(1)}%` : '—'}
          hint={
            Number.isFinite(result.fireNumber)
              ? `目標 ${formatCurrency(result.fireNumber, profile.currency)}`
              : undefined
          }
        />
        <StatCard
          label="預估達成時間"
          value={progressStat}
          hint={result.targetDate ? formatDate(result.targetDate) : undefined}
        />
        <Link to="/records" className="block">
          <StatCard
            label="本月淨收支"
            value={
              currentMonthNetCashFlow !== null
                ? formatCurrency(currentMonthNetCashFlow, profile.currency)
                : '—'
            }
            hint={currentMonthRecord ? undefined : '尚無本月紀錄'}
          />
        </Link>
      </div>

      <StrategyOverview />

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            淨值進度
          </h2>
          <Link
            to="/progress"
            className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
          >
            前往進度追蹤
          </Link>
        </div>
        <ActualVsProjectedChart
          projectedPoints={result.points}
          checkIns={checkIns}
          currency={profile.currency}
        />
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            最新市場建議
          </h2>
          <Link
            to="/market"
            className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
          >
            前往市場檢視
          </Link>
        </div>
        <AdviceSummary
          advice={advice}
          emptyMessage="還沒有任何市場評估，前往市場檢視新增第一筆吧。"
        />
      </div>
    </div>
  )
}
