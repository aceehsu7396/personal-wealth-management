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
import { MACRO_PRIMARY_SOURCE } from '../lib/ai/analyses'
import { refreshMacro } from '../lib/ai/macroRefresh'
import { FubonOutlookCard, FubonUsageNote } from './research/FubonOutlookCard'
import { useResearchTask } from '../lib/ai/useResearchTask'
import { latestOutlook, MACRO_SIGNAL_LABELS, PILLAR_LABELS } from '../lib/calculations/fubonTracking'
import { todayIsoDate } from '../lib/market/twse'
import type { MacroCheckIn, MacroSignalKey } from '../lib/storage/schema'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'

const DIRECTION_TEXT = { up: '上升 ↑', flat: '持平 →', down: '下降 ↓' } as const
const SIGNAL_TEXT: Record<string, Record<number, string>> = {
  liquidity: { 1: '寬鬆 +1', 0: '中性 0', [-1]: '緊縮 −1' },
  sentiment: { 1: '過熱 +1', 0: '正常 0', [-1]: '恐慌 −1' },
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`
}

function signalValue(checkIn: MacroCheckIn, key: MacroSignalKey): string {
  const [pillar, field] = key.split('.') as ['growth' | 'inflation' | 'liquidity' | 'sentiment', string]
  const value = (checkIn[pillar] as Record<string, string | number>)[field]
  return typeof value === 'string' ? DIRECTION_TEXT[value as keyof typeof DIRECTION_TEXT] : SIGNAL_TEXT[pillar][value]
}

// The 17 signals of a check-in with the reason behind each, by pillar.
function SignalReasons({ checkIn }: { checkIn: MacroCheckIn }) {
  const keys = Object.keys(MACRO_SIGNAL_LABELS) as MacroSignalKey[]
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">
        17 個訊號與判斷依據
      </summary>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Object.entries(PILLAR_LABELS).map(([pillar, label]) => (
          <div key={pillar}>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}</p>
            <ul className="mt-1 space-y-1 text-xs">
              {keys
                .filter((k) => k.startsWith(`${pillar}.`))
                .map((k) => (
                  <li key={k} className="text-gray-600 dark:text-gray-400">
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {MACRO_SIGNAL_LABELS[k]}：{signalValue(checkIn, k)}
                    </span>
                    {checkIn.reasons?.[k] && <span className="block">{checkIn.reasons[k]}</span>}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}

export function MacroPanel() {
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const guardrails = useAppStore((s) => s.guardrails)
  const updateMacroCheckIn = useAppStore((s) => s.updateMacroCheckIn)
  const removeMacroCheckIn = useAppStore((s) => s.removeMacroCheckIn)
  const upsertMonthlyMacroCheckIn = useAppStore((s) => s.upsertMonthlyMacroCheckIn)
  const upsertFubonOutlook = useAppStore((s) => s.upsertFubonOutlook)

  const reports = useAppStore((s) => s.researchReports)
  const addResearchReport = useAppStore((s) => s.addResearchReport)
  const removeResearchReport = useAppStore((s) => s.removeResearchReport)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [step, setStep] = useState<'digest' | 'analysis' | null>(null)
  const [digestWarning, setDigestWarning] = useState<string | null>(null)
  const task = useResearchTask()
  const marketReports = reports.filter((r) => r.kind === 'market').reverse()

  // One button for the whole monthly review: digest the latest Fubon
  // outlook (when a new month's issue may be out), search only the signals
  // it does not cover, and save the month's check-in automatically.
  async function refresh() {
    const today = todayIsoDate()
    setDigestWarning(null)
    const result = await task.run(() => refreshMacro(today, useAppStore.getState().fubonOutlooks, undefined, setStep))
    setStep(null)
    if (!result) return
    if (result.newOutlook) upsertFubonOutlook(result.newOutlook)
    if (result.digestError) setDigestWarning(result.digestError)
    const outlook = result.usedOutlook ? latestOutlook(useAppStore.getState().fubonOutlooks) : undefined
    const reportId = addResearchReport({
      kind: 'market',
      fubonOutlookId: outlook?.id,
      subject: '台股＋美股總經三支柱',
      market: 'TW+US',
      markdown: result.research.markdown,
      sources: result.research.sources,
      facts: undefined,
      estimatedCostUsd: result.estimatedCostUsd,
    })
    upsertMonthlyMacroCheckIn({ ...result.checkIn, reportId })
    setEditingId(null)
  }

  const sorted = [...macroCheckIns].sort((a, b) => b.date.localeCompare(a.date))
  const latest = sorted[0]
  const assessment = latest ? assessMacro(latest, guardrails) : null
  const editing = editingId ? macroCheckIns.find((c) => c.id === editingId) : undefined

  function handleEdit(values: MacroCheckInFormValues) {
    if (!editingId) return
    updateMacroCheckIn(editingId, { ...values, note: values.note || '已手動修正' })
    setEditingId(null)
  }

  return (
    <>
      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">總經三支柱判斷</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          景氣體制（達利歐四象限）＋ 流動性（朱肯米勒）＋ 情緒溫度（馬克斯鐘擺）。總經只調整股債比例，不決定個股進出。
        </p>
        <div className="mt-4 rounded-md bg-gray-50 p-4 dark:bg-gray-900/40">
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
            每月按一次：自動整理{' '}
            <a href={MACRO_PRIMARY_SOURCE} target="_blank" rel="noreferrer" className="font-medium text-indigo-700 underline dark:text-indigo-400">
              富邦金控研究報告
            </a>{' '}
            最新一期「富邦總經觀點」，只上網補查富邦未涵蓋的訊號，再自動判斷 17 個訊號並存成本月的總經檢視（同月重新取得會覆蓋）。
          </p>
          <AiActionButton
            label="取得最新總經資訊"
            running={task.running}
            error={task.error}
            hasApiKey={task.hasApiKey}
            costNote="每月一次，約 US$0.3–0.6，使用你的 Anthropic API 金鑰"
            runningLabel={step === 'digest' ? '1/2 整理富邦最新報告…' : '2/2 補查其餘訊號並判斷…（約 1–3 分鐘）'}
            onClick={() => void refresh()}
          />
          {digestWarning && (
            <p className="mt-2 text-xs text-orange-700 dark:text-orange-400">
              富邦報告整理失敗（{digestWarning}），這次總經判斷改由網路搜尋取得。
            </p>
          )}
        </div>
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
            <SignalReasons checkIn={latest} />
            {reports.find((r) => r.id === latest.reportId) && (
              <FubonUsageNote report={reports.find((r) => r.id === latest.reportId)!} />
            )}
            <button
              type="button"
              onClick={() => setEditingId(latest.id)}
              className="mt-3 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
            >
              判斷有誤？手動修正
            </button>
          </>
        ) : (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            還沒有總經檢視。建議每月第一週按上方按鈕取得一次。
          </p>
        )}
      </div>

      {editing && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">手動修正總經檢視（{editing.date}）</h2>
          <div className="mt-4">
            <MacroCheckInForm
              key={editing.id}
              initialValues={editing}
              reasons={editing.reasons}
              onSubmit={handleEdit}
              onCancel={() => setEditingId(null)}
            />
          </div>
        </div>
      )}

      <FubonOutlookCard />

      {marketReports.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">AI 市場分析報告</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">每次取得總經資訊時的研究全文與出處。</p>
          <div className="mt-4 space-y-3">
            {marketReports.map((r) => (
              <div key={r.id}>
                <ResearchReportCard report={r} onDelete={() => removeResearchReport(r.id)} />
                <FubonUsageNote report={r} />
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
