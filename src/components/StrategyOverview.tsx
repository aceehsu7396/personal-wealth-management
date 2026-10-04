import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { useJourney } from '../lib/useJourney'
import { computeRequiredReturn, FEASIBILITY_LABELS } from '../lib/calculations/requiredReturn'
import { assessMacro, STANCE_LABELS } from '../lib/calculations/macroRegime'
import { analyzePortfolio } from '../lib/calculations/portfolioRisk'
import { addMonths, computeDiscipline } from '../lib/calculations/disciplineScore'
import { todayIsoDate } from '../lib/market/twse'
import { StatCard } from './StatCard'
import { RiskViolationList } from './RiskViolationList'

const MAX_ALERTS = 5
// Research cards should be refreshed after every quarterly report.
const THESIS_STALE_MONTHS = 4

export function StrategyOverview() {
  const profile = useAppStore((s) => s.profile)
  const assumptions = useAppStore((s) => s.assumptions)
  const { policy, journey } = useJourney()
  const guardrails = useAppStore((s) => s.guardrails)
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  const meta = useAppStore((s) => s.portfolioMeta)
  const trades = useAppStore((s) => s.trades)

  const today = todayIsoDate()
  const required = computeRequiredReturn(profile, assumptions, policy.targetYears)
  const latestMacro = [...macroCheckIns].sort((a, b) => b.date.localeCompare(a.date))[0]
  const macro = latestMacro ? assessMacro(latestMacro, guardrails) : null
  const risk = analyzePortfolio(holdings, theses, policy, guardrails, meta)
  const discipline = computeDiscipline(trades, holdings, theses, policy, today)

  const todos: { text: string; to: string }[] = []
  // Macro reviews belong to stage three; only nag once the core is in place
  // or the habit has started.
  const macroStageReached = journey.stages[1].done || latestMacro !== undefined
  if (macroStageReached && (!latestMacro || addMonths(latestMacro.date, 1) <= today)) {
    todos.push({ text: '本月的總經三支柱檢視尚未完成', to: '/market' })
  }
  const stale = theses.filter(
    (t) => t.status !== 'exited' && addMonths(t.updatedAt.slice(0, 10), THESIS_STALE_MONTHS) <= today,
  )
  if (stale.length > 0) {
    todos.push({
      text: `${stale.length} 張研究卡超過 ${THESIS_STALE_MONTHS} 個月未更新（${stale
        .slice(0, 3)
        .map((t) => t.ticker)
        .join('、')}${stale.length > 3 ? '…' : ''}）`,
      to: '/research',
    })
  }
  if (discipline.pendingReviews.length > 0) {
    todos.push({ text: `${discipline.pendingReviews.length} 筆交易待完成事後檢討`, to: '/trades' })
  }

  const alerts = risk.violations.filter((v) => v.severity !== 'info')

  return (
    <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">投資策略紀律</h2>
        <Link
          to="/strategy"
          className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
        >
          前往投資策略
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/strategy" className="block">
          <StatCard
            label={`${policy.targetYears} 年所需報酬`}
            value={
              required.requiredNominalReturnPercent === null
                ? '—'
                : `${required.requiredNominalReturnPercent.toFixed(1)}%`
            }
            hint={
              assumptions.monthlyExpenses > 0
                ? FEASIBILITY_LABELS[required.feasibility].split('：')[0]
                : '尚未設定目標'
            }
          />
        </Link>
        <Link to="/market" className="block">
          <StatCard
            label="總經判斷"
            value={macro ? STANCE_LABELS[macro.stance] : '—'}
            hint={latestMacro ? `${latestMacro.date} 檢視` : '尚無總經檢視'}
          />
        </Link>
        <Link to="/portfolio" className="block">
          <StatCard
            label="風控警示"
            value={`${alerts.length}`}
            hint={risk.circuitBreakerActive ? '回撤熔斷中' : holdings.length === 0 ? '尚無持股' : undefined}
          />
        </Link>
        <Link to="/trades" className="block">
          <StatCard
            label="紀律分數"
            value={discipline.score === null ? '—' : `${discipline.score}`}
            hint={discipline.tier}
          />
        </Link>
      </div>

      {(alerts.length > 0 || todos.length > 0) && (
        <div className="mt-5 space-y-3">
          {alerts.length > 0 && (
            <RiskViolationList violations={alerts.slice(0, MAX_ALERTS)} emptyMessage="" />
          )}
          {alerts.length > MAX_ALERTS && (
            <Link to="/portfolio" className="text-xs text-indigo-700 hover:underline dark:text-indigo-400">
              還有 {alerts.length - MAX_ALERTS} 項警示，前往投資組合查看
            </Link>
          )}
          {todos.length > 0 && (
            <ul className="space-y-1 text-sm">
              {todos.map((t) => (
                <li key={t.text}>
                  <Link to={t.to} className="text-gray-700 hover:underline dark:text-gray-300">
                    ☐ {t.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
