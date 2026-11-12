import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { useJourney } from '../lib/useJourney'
import { usePlanningAssumptions } from '../lib/usePlanningAssumptions'
import { computeRequiredReturn, FEASIBILITY_LABELS } from '../lib/calculations/requiredReturn'
import { analyzePortfolio } from '../lib/calculations/portfolioRisk'
import { penaltySummary, computeDiscipline } from '../lib/calculations/disciplineScore'
import { todayIsoDate } from '../lib/market/twse'
import { useTraderReadiness } from '../lib/useTraderReadiness'
import { StatCard } from './StatCard'
import { RiskViolationList } from './RiskViolationList'
import { formatCurrency } from '../lib/format'

const MAX_ALERTS = 5

export function StrategyOverview() {
  const profile = useAppStore((s) => s.profile)
  const { assumptions, fromPortfolio } = usePlanningAssumptions()
  const { policy } = useJourney()
  const guardrails = useAppStore((s) => s.guardrails)
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  const meta = useAppStore((s) => s.portfolioMeta)
  const trades = useAppStore((s) => s.trades)

  const today = todayIsoDate()
  const required = computeRequiredReturn(profile, assumptions, policy.targetYears)
  const risk = analyzePortfolio(holdings, theses, policy, guardrails, meta)
  const plans = useAppStore((s) => s.tradePlans)
  const discipline = computeDiscipline(trades, holdings, theses, policy, today, plans)
  const readiness = useTraderReadiness()
  const foundation = useAppStore((s) => s.foundation)
  // Months of living costs held outside the portfolio, and what share of
  // the portfolio a year of living costs would take today.
  const bufferMonths = assumptions.monthlyExpenses > 0 ? foundation.emergencyFundAmount / assumptions.monthlyExpenses : null
  const withdrawalRate =
    readiness.target.annualExpenses > 0 && assumptions.currentNetWorth > 0
      ? (readiness.target.annualExpenses / assumptions.currentNetWorth) * 100
      : null
  const alerts = risk.violations.filter((v) => v.severity !== 'info')

  return (
    <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">資產經營與提領準備</h2>
        <Link
          to="/goals"
          className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
        >
          前往目標與政策
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="淨資產（投資組合市值）"
          value={formatCurrency(assumptions.currentNetWorth, profile.currency)}
          hint={fromPortfolio ? '依持股即時計算，每月自動記錄' : '尚未建立持股，暫用目標與政策的輸入'}
        />
        <Link to="/goals" className="block">
          <StatCard
            label="全職準備度"
            value={`${readiness.metCount}/${readiness.items.length}`}
            hint={
              assumptions.monthlyExpenses <= 0
                ? '尚未設定目標'
                : required.requiredNominalReturnPercent === null
                  ? FEASIBILITY_LABELS[required.feasibility].split('：')[0]
                  : `${policy.targetYears} 年所需報酬 ${required.requiredNominalReturnPercent.toFixed(1)}%`
            }
          />
        </Link>
        <Link to="/goals" className="block">
          <StatCard
            label="生活費緩衝"
            value={bufferMonths === null ? '—' : `${bufferMonths.toFixed(1)} 個月`}
            hint={`全職前目標 ${foundation.livingBufferMonths} 個月（現金／短債）`}
          />
        </Link>
        <Link to="/portfolio" className="block">
          <StatCard
            label="組合回撤"
            value={holdings.length === 0 ? '—' : `${risk.drawdownPercent.toFixed(1)}%`}
            hint={
              risk.circuitBreakerActive
                ? '回撤熔斷中'
                : `熔斷 −${policy.drawdownCircuitBreakerPercent}%・上限 −${policy.maxDrawdownTolerancePercent}%${alerts.length > 0 ? `・${alerts.length} 項風控警示` : ''}`
            }
          />
        </Link>
        <Link to="/goals" className="block">
          <StatCard
            label="目前提領率"
            value={withdrawalRate === null ? '—' : `${withdrawalRate.toFixed(1)}%`}
            hint={`年生活費 ÷ 投資組合；可持續 ${assumptions.safeWithdrawalRatePercent}% 以下`}
          />
        </Link>
        <Link to="/portfolio/trades" className="block">
          <StatCard
            label="紀律分數"
            value={discipline.score === null ? '—' : `${discipline.score}`}
            hint={`${discipline.tier}；${penaltySummary(discipline)}`}
          />
        </Link>
      </div>

      {alerts.length > 0 && (
        <div className="mt-5 space-y-3">
          {alerts.length > 0 && (
            <RiskViolationList violations={alerts.slice(0, MAX_ALERTS)} emptyMessage="" />
          )}
          {alerts.length > MAX_ALERTS && (
            <Link to="/portfolio" className="text-xs text-indigo-700 hover:underline dark:text-indigo-400">
              還有 {alerts.length - MAX_ALERTS} 項警示，前往投資組合查看
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
