import { useAppStore } from '../lib/storage/appStore'
import { computeFireProjection } from '../lib/calculations/fireProjection'
import { AssumptionsForm } from '../components/forms/AssumptionsForm'
import { NetWorthProjectionChart } from '../components/charts/NetWorthProjectionChart'
import { StatCard } from '../components/StatCard'
import { formatCurrency, formatDate, formatYearsToFire } from '../lib/format'

export function FireCalculatorPage() {
  const profile = useAppStore((s) => s.profile)
  const assumptions = useAppStore((s) => s.assumptions)
  const result = computeFireProjection(profile, assumptions)

  const progressStat = result.alreadyFire
    ? '已達成財富自由'
    : result.yearsToFire === null
      ? '目前假設下 50 年內無法達成'
      : `約 ${formatYearsToFire(result.yearsToFire)}`

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        財務自由試算
      </h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        輸入現況與假設，估算達成財富自由所需的時間。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="財務自由目標金額"
          value={
            Number.isFinite(result.fireNumber)
              ? formatCurrency(result.fireNumber, profile.currency)
              : '—'
          }
          hint={`年支出 ${formatCurrency(result.targetAnnualExpenses, profile.currency)} ÷ 安全提領率`}
        />
        <StatCard
          label="預估達成時間"
          value={progressStat}
          hint={result.targetDate ? formatDate(result.targetDate) : undefined}
        />
        <StatCard
          label="目前淨資產"
          value={formatCurrency(assumptions.currentNetWorth, profile.currency)}
        />
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <NetWorthProjectionChart
          points={result.points}
          fireNumber={result.fireNumber}
          currency={profile.currency}
        />
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          假設輸入
        </h2>
        <div className="mt-4">
          <AssumptionsForm />
        </div>
      </div>
    </div>
  )
}
