import { useState } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { analyzeIndustry, MARKET_NAMES } from '../../lib/ai/analyses'
import { useResearchTask } from '../../lib/ai/useResearchTask'
import { todayIsoDate } from '../../lib/market/twse'
import type { Market } from '../../lib/storage/schema'
import { inputClass, labelClass } from '../forms/FormField'
import { AiActionButton } from './AiActionButton'
import { ResearchReportCard } from './ResearchReportCard'

// Industry research: an AI web report on one industry in one market. It is
// study material for the research cards, not a list of things to buy.
export function IndustryAnalysisPanel() {
  const theses = useAppStore((s) => s.stockTheses)
  const reports = useAppStore((s) => s.researchReports)
  const addResearchReport = useAppStore((s) => s.addResearchReport)
  const removeResearchReport = useAppStore((s) => s.removeResearchReport)
  const task = useResearchTask()

  const [industry, setIndustry] = useState('')
  const [market, setMarket] = useState<Market>('TW')
  const [latestId, setLatestId] = useState<string | null>(null)

  const sectors = [...new Set(theses.map((t) => t.sector.trim()).filter(Boolean))]
  const industryReports = reports.filter((r) => r.kind === 'industry').reverse()

  async function run() {
    const subject = industry.trim()
    const result = await task.run(() => analyzeIndustry(subject, market, todayIsoDate()))
    if (!result) return
    const id = addResearchReport({
      kind: 'industry',
      subject: `${MARKET_NAMES[market]}・${subject}`,
      market,
      markdown: result.research.markdown,
      sources: result.research.sources,
      estimatedCostUsd: result.estimatedCostUsd,
    })
    setLatestId(id)
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className={labelClass}>產業</span>
          <input
            type="text"
            list="industry-suggestions"
            placeholder="例如：半導體、雲端軟體、電動車"
            className={inputClass}
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          />
          <datalist id="industry-suggestions">
            {sectors.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className={labelClass}>市場</span>
          <select className={inputClass} value={market} onChange={(e) => setMarket(e.target.value as Market)}>
            <option value="TW">台灣</option>
            <option value="US">美國</option>
          </select>
        </label>
      </div>
      <div className="mt-4">
        <AiActionButton
          label="AI 產業分析"
          running={task.running}
          error={task.error}
          hasApiKey={task.hasApiKey}
          disabled={!industry.trim()}
          onClick={() => void run()}
        />
      </div>
      {industryReports.length > 0 && (
        <div className="mt-4 space-y-3">
          {industryReports.map((r) => (
            <ResearchReportCard
              key={r.id}
              report={r}
              defaultOpen={r.id === latestId}
              onDelete={() => removeResearchReport(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
