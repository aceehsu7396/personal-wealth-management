import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { computeFireProjection } from '../lib/calculations/fireProjection'
import { computeProgressPercent } from '../lib/calculations/progress'
import { computeAdvice } from '../lib/calculations/adviceRules'
import { computeNetCashFlow } from '../lib/calculations/netCashFlow'
import { isReviewDue } from '../lib/reviewSchedule'
import { StatCard } from '../components/StatCard'
import { AdviceSummary } from '../components/AdviceSummary'
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

  const isFirstRun =
    checkIns.length === 0 &&
    marketCheckIns.length === 0 &&
    assumptions.currentNetWorth === 0 &&
    assumptions.monthlyExpenses === 0

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">儀表板</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        財富自由計畫的整體現況一覽。
      </p>

      {isFirstRun && (
        <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          歡迎使用！建議先到{' '}
          <Link to="/fire" className="font-medium underline">
            FIRE 試算
          </Link>{' '}
          填入現況與假設，開始估算你的財富自由時間點。
        </div>
      )}

      {!isFirstRun && reviewDue && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
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

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            淨值進度
          </h2>
          <Link
            to="/progress"
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
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

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            最新市場建議
          </h2>
          <Link
            to="/market"
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
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
