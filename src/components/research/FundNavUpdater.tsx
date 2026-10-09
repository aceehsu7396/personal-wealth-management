import { useState } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { lookupFundNavs, type NavUpdateRow } from '../../lib/ai/fundNav'
import { useResearchTask } from '../../lib/ai/useResearchTask'
import { isFund } from '../../lib/calculations/fundRules'
import { todayIsoDate } from '../../lib/market/twse'
import { AiActionButton } from './AiActionButton'
import { ResearchReportCard } from './ResearchReportCard'

// Looks up the latest NAV of every fund holding with AI web search, then lets
// the user tick which values to apply. Nothing changes until "套用".
export function FundNavUpdater() {
  const holdings = useAppStore((s) => s.holdings)
  const updateHolding = useAppStore((s) => s.updateHolding)
  const addResearchReport = useAppStore((s) => s.addResearchReport)
  const reports = useAppStore((s) => s.researchReports)
  const removeResearchReport = useAppStore((s) => s.removeResearchReport)
  const task = useResearchTask()

  const [rows, setRows] = useState<NavUpdateRow[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)

  const funds = holdings.filter((h) => isFund(h) && h.shares > 0)
  if (funds.length === 0) return null
  const report = reports.find((r) => r.id === reportId)

  async function run() {
    setAppliedCount(null)
    const result = await task.run(() => lookupFundNavs(funds, todayIsoDate()))
    if (!result) return
    const id = addResearchReport({
      kind: 'fund',
      subject: `基金淨值（${funds.length} 檔）`,
      market: 'TW+US',
      markdown: result.research.markdown,
      sources: result.research.sources,
      facts: result.rows.map((r) => ({ ticker: r.holding.ticker, nav: r.nav, navDate: r.navDate })),
      estimatedCostUsd: result.estimatedCostUsd,
    })
    setReportId(id)
    setRows(result.rows)
    setSelected(new Set(result.rows.filter((r) => r.applicable).map((r) => r.holding.id)))
  }

  function apply() {
    if (!rows) return
    let count = 0
    for (const r of rows) {
      if (!selected.has(r.holding.id) || r.nav === null) continue
      updateHolding(r.holding.id, { currentPrice: r.nav, priceUpdatedAt: r.navDate || todayIsoDate() })
      count += 1
    }
    setAppliedCount(count)
    setRows(null)
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  return (
    <div className="mt-4 rounded-md bg-gray-50 p-4 dark:bg-gray-900/40">
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
        基金淨值無法自動取得。可手動編輯，或讓 AI 上網查詢 {funds.length} 檔基金的最新淨值，確認後再套用。
      </p>
      <AiActionButton
        label="AI 取得最新淨值"
        running={task.running}
        error={task.error}
        hasApiKey={task.hasApiKey}
        costNote="約 US$0.1–0.3，使用你的 Anthropic API 金鑰"
        onClick={() => void run()}
      />
      {appliedCount !== null && (
        <p className="mt-2 text-sm text-indigo-700 dark:text-indigo-400">已套用 {appliedCount} 檔基金的淨值。</p>
      )}

      {rows && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="py-2 pr-3">套用</th>
                <th className="py-2 pr-3">基金</th>
                <th className="py-2 pr-3">目前淨值</th>
                <th className="py-2 pr-3">查到的淨值</th>
                <th className="py-2 pr-3">說明</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.holding.id} className="border-b border-gray-100 align-top last:border-0 dark:border-gray-700">
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      aria-label={`套用 ${r.holding.ticker}`}
                      disabled={r.nav === null}
                      checked={selected.has(r.holding.id)}
                      onChange={() => toggle(r.holding.id)}
                    />
                  </td>
                  <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">
                    {r.holding.ticker} {r.holding.name}
                  </td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                    {r.holding.currentPrice}
                    {r.holding.priceUpdatedAt && <div className="text-xs text-gray-400">{r.holding.priceUpdatedAt}</div>}
                  </td>
                  <td className="py-2 pr-3 font-medium text-gray-900 dark:text-gray-100">
                    {r.nav ?? '—'}
                    {r.navDate && <div className="text-xs font-normal text-gray-400">{r.navDate}</div>}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-500 dark:text-gray-400">
                    {r.reason && <span className="text-orange-700 dark:text-orange-400">{r.reason}。</span>}
                    {r.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={apply}
              disabled={selected.size === 0}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              套用勾選的淨值
            </button>
            <button
              type="button"
              onClick={() => setRows(null)}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              放棄
            </button>
          </div>
        </div>
      )}

      {report && (
        <div className="mt-4">
          <ResearchReportCard report={report} onDelete={() => removeResearchReport(report.id)} />
        </div>
      )}
    </div>
  )
}
