import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { usePlanningAssumptions } from '../lib/usePlanningAssumptions'
import { todayIsoDate } from '../lib/market/twse'
import { computeFireProjection } from '../lib/calculations/fireProjection'
import {
  computeRequiredReturn,
  FEASIBILITY_LABELS,
} from '../lib/calculations/requiredReturn'
import { InvestmentPolicyForm } from '../components/forms/InvestmentPolicyForm'
import { StatCard } from '../components/StatCard'
import { AssumptionsForm } from '../components/forms/AssumptionsForm'
import { NetWorthProjectionChart } from '../components/charts/NetWorthProjectionChart'
import { formatCurrency, formatDate, formatYearsToFire } from '../lib/format'
import { useTraderReadiness } from '../lib/useTraderReadiness'
import { ReadinessChecklist } from '../components/ReadinessChecklist'
import { EmergencyFundForm } from '../components/forms/EmergencyFundForm'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'

export function GoalsPage() {
  const profile = useAppStore((s) => s.profile)
  const { assumptions, fromPortfolio } = usePlanningAssumptions()
  const policy = useAppStore((s) => s.investmentPolicy)
  const setInvestmentPolicy = useAppStore((s) => s.setInvestmentPolicy)
  const readiness = useTraderReadiness()

  const projection = computeFireProjection(profile, assumptions)
  const required = computeRequiredReturn(
    profile,
    assumptions,
    policy.targetYears,
  )
  const requiredText =
    required.requiredNominalReturnPercent === null
      ? '—'
      : `${required.requiredNominalReturnPercent.toFixed(2)}%`
  const meetsAssumption =
    required.requiredNominalReturnPercent !== null &&
    assumptions.expectedAnnualReturnPercent >=
      required.requiredNominalReturnPercent

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">目標與政策</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        目標是財務獨立，全職經營自有資產：生活費來自資產提領，不靠交易收入。先算出全職門檻與所需報酬，再把目標、風險與配置寫成投資政策並簽署。完整說明見手冊{' '}
        <Link to="/handbook/01" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          01 第一步
        </Link>{' '}
        與{' '}
        <Link to="/handbook/02" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          02 投資政策聲明
        </Link>
        、
        <Link to="/handbook/11" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          11 財務獨立與全職經營
        </Link>
        。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="全職門檻（投資組合）"
          value={Number.isFinite(projection.fireNumber) ? formatCurrency(projection.fireNumber, profile.currency) : '—'}
          hint={`年生活費 ÷ 提領率；另備緩衝 ${formatCurrency(readiness.target.bufferTarget, profile.currency)}`}
        />
        <StatCard
          label="依假設報酬預估達成"
          value={
            assumptions.monthlyExpenses <= 0
              ? '尚未設定目標'
              : projection.alreadyFire
                ? '已達成'
                : projection.yearsToFire === null
                  ? '50 年內無法達成'
                  : `約 ${formatYearsToFire(projection.yearsToFire)}`
          }
          hint={projection.targetDate ? formatDate(projection.targetDate) : undefined}
        />
        <StatCard
          label={`${policy.targetYears} 年所需年化報酬`}
          value={requiredText}
          hint={FEASIBILITY_LABELS[required.feasibility]}
        />
        <StatCard
          label="目前假設報酬"
          value={`${assumptions.expectedAnnualReturnPercent}%`}
          hint={
            required.requiredNominalReturnPercent === null
              ? undefined
              : meetsAssumption
                ? '假設報酬已足以在目標年限內達成'
                : '假設報酬不足，需要提高儲蓄或延長年限'
          }
        />
      </div>

      {(required.feasibility === 'unrealistic' ||
        required.feasibility === 'unreachable') && (
        <p className="mt-4 rounded-md bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-900/30 dark:text-orange-200">
          所需報酬過高。依投資政策原則，應先調整槓桿最小的變數：提高儲蓄率 →
          延長年限 → 降低支出，最後才考慮提高風險。
        </p>
      )}

      <div className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">全職準備度</h2>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {readiness.metCount}/{readiness.items.length}
            {readiness.ready ? '　可以離開本業、全職經營' : '　尚未達標，維持本業'}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          五項全部達標才建議離開本業。資產與緩衝決定「能不能」，實單紀錄、績效與紀律決定「該不該」。
        </p>
        <div className="mt-4">
          <ReadinessChecklist readiness={readiness} />
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">財務獨立門檻試算</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          填寫現況與假設（修改後自動儲存）。門檻 ＝ 年生活費 ÷ 可持續提領率；月生活費也用來計算緊急預備金與生活費緩衝。
        </p>
        <div className="mt-4">
          <NetWorthProjectionChart
            points={projection.points}
            fireNumber={projection.fireNumber}
            currency={profile.currency}
          />
        </div>
        <div className="mt-6">
          <AssumptionsForm netWorthFromPortfolio={fromPortfolio ? assumptions.currentNetWorth : null} />
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">緊急預備金／生活費緩衝</h2>
        <EmergencyFundForm />
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          投資政策參數
        </h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          修改後自動儲存。這些參數會套用在策略卡、研究卡、投資組合風控與交易前檢核；每筆交易都必須設停損（策略進場）。
        </p>
        <div className="mt-4">
          <InvestmentPolicyForm />
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          簽署投資政策聲明
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          確認目標、風險與配置都是你在冷靜時願意遵守的規則後簽署。簽署後只在每年 1 月或人生重大事件時修改；這是行動路線的步驟 1.4。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setInvestmentPolicy({ signedAt: todayIsoDate() })}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {policy.signedAt ? '重新簽署（年度檢討後）' : '我已確認，簽署投資政策聲明'}
          </button>
          {policy.signedAt && (
            <span className="text-sm text-indigo-700 dark:text-indigo-400">✓ 已於 {policy.signedAt} 簽署</span>
          )}
        </div>
      </div>

      <p className="mt-8 text-sm text-gray-600 dark:text-gray-400">
        策略原則見手冊{' '}
        <Link to="/handbook/00" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          00 §3 五項設計原則
        </Link>{' '}
        與{' '}
        <Link to="/handbook/02" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          02 投資政策聲明
        </Link>
        。
      </p>
    </div>
  )
}
