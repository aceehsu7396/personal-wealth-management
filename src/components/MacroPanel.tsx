import { useState } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import {
  assessMacro,
  formatTiltRange,
  REGIME_LABELS,
  STANCE_LABELS,
} from '../lib/calculations/macroRegime'
import { MacroCheckInForm, type MacroCheckInFormValues } from './forms/MacroCheckInForm'
import { StatCard } from './StatCard'
import { AiActionButton } from './research/AiActionButton'
import { ResearchReportCard } from './research/ResearchReportCard'
import { analyzeMarket, macroDraftToForm, MacroDraftSchema } from '../lib/ai/analyses'
import { useResearchTask } from '../lib/ai/useResearchTask'
import { todayIsoDate } from '../lib/market/twse'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'

const DIRECTION_TEXT = { up: '上升 ↑', flat: '持平 →', down: '下降 ↓' } as const

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`
}

export function MacroPanel() {
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const guardrails = useAppStore((s) => s.guardrails)
  const addMacroCheckIn = useAppStore((s) => s.addMacroCheckIn)
  const updateMacroCheckIn = useAppStore((s) => s.updateMacroCheckIn)
  const removeMacroCheckIn = useAppStore((s) => s.removeMacroCheckIn)

  const reports = useAppStore((s) => s.researchReports)
  const addResearchReport = useAppStore((s) => s.addResearchReport)
  const removeResearchReport = useAppStore((s) => s.removeResearchReport)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  // AI-prefilled form values waiting for the user's confirmation.
  const [draft, setDraft] = useState<{
    values: MacroCheckInFormValues
    reasons: Record<string, string>
    reportId: string
  } | null>(null)
  const task = useResearchTask()
  const marketReports = reports.filter((r) => r.kind === 'market').reverse()

  function applyReportDraft(reportId: string, facts: unknown) {
    const parsed = MacroDraftSchema.safeParse(facts)
    if (!parsed.success) return
    setEditingId(null)
    setDraft({ ...macroDraftToForm(parsed.data, todayIsoDate()), reportId })
  }

  async function runMarketAnalysis() {
    const result = await task.run(() => analyzeMarket(todayIsoDate()))
    if (!result) return
    const reportId = addResearchReport({
      kind: 'market',
      subject: '台股＋美股總經三支柱',
      market: 'TW+US',
      markdown: result.research.markdown,
      sources: result.research.sources,
      facts: result.facts ?? undefined,
      estimatedCostUsd: result.estimatedCostUsd,
    })
    applyReportDraft(reportId, result.facts)
  }

  const sorted = [...macroCheckIns].sort((a, b) => b.date.localeCompare(a.date))
  const latest = sorted[0]
  const assessment = latest ? assessMacro(latest, guardrails) : null
  const editing = editingId ? macroCheckIns.find((c) => c.id === editingId) : undefined

  function handleSubmit(values: MacroCheckInFormValues) {
    if (editingId) {
      updateMacroCheckIn(editingId, values)
      setEditingId(null)
      return
    }
    addMacroCheckIn(values)
    setDraft(null)
  }

  return (
    <>
      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          總經三支柱判斷
        </h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          景氣體制（達利歐四象限）＋ 流動性（朱肯米勒）＋ 情緒溫度（馬克斯鐘擺）。總經只調整股債比例，不決定個股進出。
        </p>
        {assessment && latest ? (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="景氣體制"
                value={REGIME_LABELS[assessment.regime].split('（')[0]}
                hint={`成長 ${DIRECTION_TEXT[assessment.growthDirection]}、通膨 ${DIRECTION_TEXT[assessment.inflationDirection]}`}
              />
              <StatCard
                label="流動性分數"
                value={signed(assessment.liquidityScore)}
                hint="−5 緊縮 ～ +5 寬鬆"
              />
              <StatCard
                label="情緒溫度"
                value={signed(assessment.sentimentScore)}
                hint="−6 恐慌 ～ +6 過熱"
              />
              <StatCard
                label="綜合判斷"
                value={STANCE_LABELS[assessment.stance]}
                hint={`${latest.date} 檢視`}
              />
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="font-medium text-gray-700 dark:text-gray-300">股票戰術傾斜</dt>
                <dd className="text-gray-600 dark:text-gray-400">
                  {formatTiltRange(assessment.tiltMinPoints, assessment.tiltMaxPoints)}
                  ，股票配置不得低於下限 {guardrails.minEquityFloorPercent}%；每季最多調整一次。
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700 dark:text-gray-300">行動</dt>
                <dd className="text-gray-600 dark:text-gray-400">{assessment.actionNote}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700 dark:text-gray-300">衛星新建倉</dt>
                <dd className="text-gray-600 dark:text-gray-400">
                  {assessment.satelliteNewPositionsAllowed ? '允許' : '暫停（交易前檢核會標示）'}
                </dd>
              </div>
              {latest.policyNote && (
                <div>
                  <dt className="font-medium text-gray-700 dark:text-gray-300">政策面</dt>
                  <dd className="text-gray-600 dark:text-gray-400">{latest.policyNote}</dd>
                </div>
              )}
            </dl>
          </>
        ) : (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            還沒有總經檢視，建議每月第一週新增一筆。
          </p>
        )}
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {editing ? '編輯總經檢視' : draft ? '新增總經檢視（AI 草稿）' : '新增總經檢視'}
        </h2>
        {!editing && (
          <div className="mt-3 rounded-md bg-gray-50 p-4 dark:bg-gray-900/40">
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
              讓 AI 上網搜尋台股與美股最新的總經資料，產出研究報告，並預填下方 17 個訊號與判斷理由。你確認或修改後才會儲存。
            </p>
            <AiActionButton
              label="AI 取得總經資訊並預填"
              running={task.running}
              error={task.error}
              hasApiKey={task.hasApiKey}
              onClick={() => void runMarketAnalysis()}
            />
          </div>
        )}
        {draft && !editing && (
          <p className="mt-3 text-sm text-orange-800 dark:text-orange-200">
            以下是 AI 預填的草稿，橘色文字是每個訊號的判斷理由。請逐項確認，必要時修改，再按「確認並新增總經檢視」。
            <button type="button" onClick={() => setDraft(null)} className="ml-2 font-medium underline">
              放棄草稿
            </button>
          </p>
        )}
        <div className="mt-4">
          <MacroCheckInForm
            key={editingId ?? draft?.reportId ?? 'new'}
            initialValues={editing ?? draft?.values}
            reasons={editing ? undefined : draft?.reasons}
            submitLabel={draft && !editing ? '確認並新增總經檢視' : undefined}
            onSubmit={handleSubmit}
            onCancel={editing ? () => setEditingId(null) : undefined}
          />
        </div>
      </div>

      {marketReports.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">AI 市場分析報告</h2>
          <div className="mt-4 space-y-3">
            {marketReports.map((r, i) => (
              <div key={r.id}>
                <ResearchReportCard report={r} defaultOpen={i === 0 && draft?.reportId === r.id} onDelete={() => removeResearchReport(r.id)} />
                {r.facts !== undefined && (
                  <button
                    type="button"
                    onClick={() => applyReportDraft(r.id, r.facts)}
                    className="mt-1 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                  >
                    用這份報告預填總經檢視
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            總經檢視歷史
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-2 pr-4">日期</th>
                  <th className="py-2 pr-4">體制</th>
                  <th className="py-2 pr-4">流動性</th>
                  <th className="py-2 pr-4">情緒</th>
                  <th className="py-2 pr-4">判斷</th>
                  <th className="py-2 pr-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => {
                  const a = assessMacro(c, guardrails)
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-gray-100 last:border-0 dark:border-gray-700"
                    >
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{c.date}</td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {REGIME_LABELS[a.regime].split('（')[0]}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {signed(a.liquidityScore)}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {signed(a.sentimentScore)}
                      </td>
                      <td className="py-2 pr-4 font-medium text-gray-900 dark:text-gray-100">
                        {STANCE_LABELS[a.stance]}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDeleteId(null)
                              setEditingId(c.id)
                            }}
                            className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                          >
                            編輯
                          </button>
                          {pendingDeleteId === c.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  removeMacroCheckIn(c.id)
                                  setPendingDeleteId(null)
                                  if (editingId === c.id) setEditingId(null)
                                }}
                                className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                              >
                                確定刪除
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteId(null)}
                                className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(c.id)}
                              className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                            >
                              刪除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
