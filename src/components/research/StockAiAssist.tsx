import { useAppStore } from '../../lib/storage/appStore'
import { analyzeStock, StockFactsSchema, type StockFacts } from '../../lib/ai/analyses'
import { useResearchTask } from '../../lib/ai/useResearchTask'
import { todayIsoDate } from '../../lib/market/twse'
import type { Market } from '../../lib/storage/schema'
import { AiActionButton } from './AiActionButton'
import { ResearchReportCard } from './ResearchReportCard'

// AI stock research inside the research card form: runs the web research,
// saves the report and hands the factual data back to the form as a draft.
export function StockAiAssist({
  ticker,
  name,
  market,
  thesisId,
  onFacts,
}: {
  ticker: string
  name: string
  market: Market
  thesisId?: string
  onFacts: (facts: StockFacts) => void
}) {
  const reports = useAppStore((s) => s.researchReports)
  const addResearchReport = useAppStore((s) => s.addResearchReport)
  const removeResearchReport = useAppStore((s) => s.removeResearchReport)
  const task = useResearchTask()

  const trimmed = ticker.trim()
  const subject = `${trimmed} ${name.trim()}`.trim()
  const related = reports
    .filter((r) => r.kind === 'stock' && r.market === market && r.subject.split(' ')[0] === trimmed)
    .reverse()
  const latest = related[0]
  const latestFacts = latest ? StockFactsSchema.safeParse(latest.facts) : null

  async function run() {
    const result = await task.run(() => analyzeStock(trimmed, name.trim(), market, todayIsoDate()))
    if (!result || !result.facts) return
    addResearchReport({
      kind: 'stock',
      subject,
      market,
      thesisId,
      markdown: result.research.markdown,
      sources: result.research.sources,
      facts: result.facts,
      estimatedCostUsd: result.estimatedCostUsd,
    })
    onFacts(result.facts)
  }

  return (
    <div className="rounded-md bg-gray-50 p-4 dark:bg-gray-900/40 sm:col-span-2">
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
        AI 會上網搜尋這檔股票的商業模式、財報、估值、風險與反方觀點，產出研究報告，並預填可查證的事實數據（現價、投入資本報酬率、成長率、F 分數）。五力、競爭力量、論點與合理價仍由你判斷。
      </p>
      <AiActionButton
        label="AI 個股分析並預填事實數據"
        running={task.running}
        error={task.error}
        hasApiKey={task.hasApiKey}
        disabled={!trimmed}
        onClick={() => void run()}
      />
      {!trimmed && <p className="mt-2 text-xs text-gray-500">先填寫代號。</p>}

      {latest && (
        <div className="mt-4 space-y-3">
          {latestFacts?.success && <FactsSummary facts={latestFacts.data} onApply={() => onFacts(latestFacts.data)} />}
          {related.map((r) => (
            <ResearchReportCard key={r.id} report={r} onDelete={() => removeResearchReport(r.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function FactsSummary({ facts, onApply }: { facts: StockFacts; onApply: () => void }) {
  return (
    <div className="rounded-md border border-orange-200 bg-white p-3 text-xs text-gray-700 dark:border-orange-800 dark:bg-gray-800 dark:text-gray-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-gray-900 dark:text-gray-100">最近一次 AI 擷取的事實數據</span>
        <button type="button" onClick={onApply} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          重新套用到表單
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        <li>
          現價：{facts.currentPrice ?? '未取得'} {facts.currency}
          {facts.priceDate && `（${facts.priceDate}）`}
        </li>
        <li>投入資本報酬率 5 年平均：{facts.roicPercent !== null ? `${facts.roicPercent}%` : '未取得'}</li>
        <li>
          過去 5 年成長率：{facts.historicalGrowthPercent !== null ? `${facts.historicalGrowthPercent}%` : '未取得'}
          {facts.growthBasis && `（${facts.growthBasis}）`}
        </li>
        <li>F 分數：{facts.fScore ?? '未能完整判斷'}</li>
        <li>財報紅旗：{facts.redFlags}</li>
      </ul>
      {facts.fScoreItems.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-gray-500">F 分數逐項</summary>
          <ul className="mt-1 space-y-0.5">
            {facts.fScoreItems.map((it) => (
              <li key={it.item}>
                {it.passed === null ? '？' : it.passed ? '✓' : '✗'} {it.item}
                {it.note && `：${it.note}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
