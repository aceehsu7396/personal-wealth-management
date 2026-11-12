import { useMemo, useState } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { useJourney } from '../../lib/useJourney'
import { useTraderReadiness } from '../../lib/useTraderReadiness'
import { usePlanningAssumptions } from '../../lib/usePlanningAssumptions'
import { analyzePortfolio } from '../../lib/calculations/portfolioRisk'
import { computeRequiredReturn, FEASIBILITY_LABELS } from '../../lib/calculations/requiredReturn'
import { summarizeAttribution, weightedReturns } from '../../lib/calculations/attribution'
import { calibration } from '../../lib/calculations/calibration'
import { annualReport } from '../../lib/calculations/annualReview'
import { executionStats, ENTRY_METHOD_LABELS } from '../../lib/trades/tradePlan'
import { adviceUptake, closedResults, groupR } from '../../lib/trades/rStats'
import { todayIsoDate } from '../../lib/market/twse'
import { useRegimeReview } from '../../lib/useRegimeReview'
import { Card, secondaryButton } from '../ui'
import { reviewerPrompt } from '../../lib/ai/prompts/agents'
import { PromptPanel } from '../ai/PromptPanel'

// The yearly review (blueprint 02 §6.4), copyable as Markdown.
export function AnnualReport() {
  const s = useAppStore()
  const { policy } = useJourney()
  const readiness = useTraderReadiness()
  const { assumptions } = usePlanningAssumptions()
  const regime = useRegimeReview()
  const thisYear = todayIsoDate().slice(0, 4)
  const years = useMemo(() => {
    const ys = new Set([thisYear, ...s.trades.map((t) => t.date.slice(0, 4)), ...s.performanceReviews.map((r) => r.periodEnd.slice(0, 4))])
    return [...ys].sort().reverse()
  }, [s.trades, s.performanceReviews, thisYear])
  const [year, setYear] = useState(thisYear)
  const [copied, setCopied] = useState(false)

  const report = useMemo(() => {
    const inYear = (d: string | undefined) => !!d && d.slice(0, 4) === year
    const reviews = s.performanceReviews.filter((r) => inYear(r.periodEnd))
    const trades = s.trades.filter((t) => inYear(t.date))
    const plans = s.tradePlans.filter((p) => inYear(p.createdAt) || inYear(p.closedAt))
    const results = closedResults(plans, s.trades)
    const summary = reviews.length ? summarizeAttribution(reviews, policy) : null
    const analysis = analyzePortfolio(s.holdings, s.stockTheses, policy, s.guardrails, s.portfolioMeta)
    const required = computeRequiredReturn(s.profile, assumptions, policy.targetYears)
    const decisions = s.decisions.filter((d) => inYear(d.date))
    const reviewed = decisions.filter((d) => d.reviewedAt)
    const segs = regime?.rows.filter((r) => inYear(r.segment.start) && (r.verdict === 'right' || r.verdict === 'wrong')) ?? []
    return annualReport({
      year,
      goal: {
        readiness: `${readiness.metCount}／${readiness.items.length} 項達成`,
        netWorth: `NT$${Math.round(analysis.totalValueTwd).toLocaleString('zh-TW')}`,
        requiredReturn: required.requiredNominalReturnPercent === null ? FEASIBILITY_LABELS[required.feasibility] : `${required.requiredNominalReturnPercent.toFixed(1)}%（${FEASIBILITY_LABELS[required.feasibility]}）`,
      },
      returns: weightedReturns(reviews),
      excessReturn: summary ? summary.cumulativeReturn - summary.cumulativeBenchmarkReturn : null,
      execution: executionStats(s.tradePlans, trades),
      uptake: adviceUptake(plans, results),
      byMethod: groupR(results, (p) => ENTRY_METHOD_LABELS[p.entryMethod]),
      exceptions: trades.filter((t) => t.exceptionReason).length,
      pauses: s.pauseReviews.filter((r) => inYear(r.date)).length,
      circuitBreaker: analysis.circuitBreakerActive,
      regimeHitRate: segs.length ? segs.filter((r) => r.verdict === 'right').length / segs.length : null,
      regimeScored: segs.length,
      calibration: calibration(s.scenarioSets.filter((x) => inYear(x.resolvedAt))),
      decisions: { total: decisions.length, reviewed: reviewed.length, avgQuality: reviewed.length ? reviewed.reduce((a, d) => a + (d.quality ?? 0), 0) / reviewed.length : null },
    })
  }, [year, s, policy, readiness, assumptions, regime])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report.markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Card
      title="年度檢討報告"
      description="每年 1 月檢討一次：目標進度、報酬、計畫執行、違規與判斷品質，最後是由固定規則產生的修訂建議。建議只是參考，修改投資政策或局勢參數仍要在冷靜時簽署。"
      action={
        <div className="flex items-center gap-3 print:hidden">
          <label className="text-sm text-gray-700 dark:text-gray-300">
            年份{' '}
            <select className="ml-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800" value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={secondaryButton} onClick={() => void copy()}>
            {copied ? '已複製' : '複製成 Markdown'}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {report.sections.map((sec) => (
          <section key={sec.title}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sec.title}</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700 dark:text-gray-300">
              {sec.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        ))}
        <section className="lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">6 修訂建議</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-800 dark:text-gray-200">
            {report.suggestions.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
        <section className="lg:col-span-2">
          <PromptPanel label="AI 檢討員" amounts build={(includeAmounts) => reviewerPrompt({ markdown: report.markdown, includeAmounts })} />
        </section>
      </div>
    </Card>
  )
}
