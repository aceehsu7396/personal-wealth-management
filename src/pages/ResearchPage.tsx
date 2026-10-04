import { useState } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { evaluateThesis, LYNCH_LABELS } from '../lib/calculations/thesisScoring'
import {
  MARKET_LABELS,
  STATUS_LABELS,
  StockThesisForm,
  type StockThesisFormValues,
} from '../components/forms/StockThesisForm'
import { PriceZoneBadge } from '../components/ThesisEvaluationView'
import { formatRatio } from '../lib/format'
import { StatCard } from '../components/StatCard'
import type { ThesisStatus } from '../lib/storage/schema'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'

type Filter = ThesisStatus | 'all'

export function ResearchPage() {
  const theses = useAppStore((s) => s.stockTheses)
  const policy = useAppStore((s) => s.investmentPolicy)
  const addStockThesis = useAppStore((s) => s.addStockThesis)
  const updateStockThesis = useAppStore((s) => s.updateStockThesis)
  const removeStockThesis = useAppStore((s) => s.removeStockThesis)

  // null = form closed, 'new' = creating, otherwise the id being edited
  const [editing, setEditing] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const editingThesis =
    editing && editing !== 'new' ? theses.find((t) => t.id === editing) : undefined
  const evaluated = theses
    .filter((t) => filter === 'all' || t.status === filter)
    .map((t) => ({ thesis: t, evaluation: evaluateThesis(t, policy) }))
    .sort((a, b) => b.evaluation.convictionScore - a.evaluation.convictionScore)

  const active = theses.filter((t) => t.status !== 'exited')
  const activeEvaluations = active.map((t) => evaluateThesis(t, policy))
  const inBuyZone = activeEvaluations.filter(
    (e) => e.priceZone === 'buy' || e.priceZone === 'strong_buy',
  ).length
  const incomplete = activeEvaluations.filter((e) => !e.isComplete).length
  const needTrim = theses
    .filter((t) => t.status === 'holding')
    .map((t) => evaluateThesis(t, policy))
    .filter((e) => e.priceZone === 'trim' || e.priceZone === 'exit_overvalued').length

  function handleSubmit(values: StockThesisFormValues) {
    if (editingThesis) updateStockThesis(editingThesis.id, values)
    else addStockThesis(values)
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">個股研究</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        產業與商業模式 ＋ 財務與價值評估：研究卡通過全部檢核，才進入衛星建倉。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="研究中標的" value={`${active.length}`} hint="觀察 + 持有" />
        <StatCard label="進入買進區" value={`${inBuyZone}`} />
        <StatCard label="持股進入減碼區" value={`${needTrim}`} hint="出場規則 ②" />
        <StatCard label="研究卡未完整" value={`${incomplete}`} hint="未完整不得建倉" />
      </div>

      {editing ? (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingThesis ? `編輯研究卡：${editingThesis.ticker}` : '新增研究卡'}
          </h2>
          <div className="mt-4">
            <StockThesisForm
              key={editing}
              policy={policy}
              initialValues={editingThesis}
              onSubmit={handleSubmit}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="mt-8 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + 新增研究卡
        </button>
      )}

      <div className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">研究卡</h2>
          <div className="flex gap-1">
            {(['all', 'watch', 'holding', 'exited'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  filter === f
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {f === 'all' ? '全部' : STATUS_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
        {evaluated.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            還沒有研究卡。先從能力圈內、最熟悉的公司開始。
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-2 pr-4">標的</th>
                  <th className="py-2 pr-4">類型</th>
                  <th className="py-2 pr-4">信心</th>
                  <th className="py-2 pr-4">現價 / 買進價</th>
                  <th className="py-2 pr-4">上下檔比</th>
                  <th className="py-2 pr-4">價位</th>
                  <th className="py-2 pr-4">檢核</th>
                  <th className="py-2 pr-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {evaluated.map(({ thesis: t, evaluation: e }) => (
                  <tr key={t.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {t.ticker} {t.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {MARKET_LABELS[t.market]}・{t.sector}・{STATUS_LABELS[t.status]}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {LYNCH_LABELS[t.lynchCategory]}
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {e.convictionScore.toFixed(1)}
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {t.currentPrice} / {e.buyPrice.toFixed(1)}
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {formatRatio(e.upsideDownsideRatio)}
                    </td>
                    <td className="py-2 pr-4">
                      <PriceZoneBadge zone={e.priceZone} />
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {e.checks.filter((c) => c.passed).length}/{e.checks.length}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPendingDeleteId(null)
                            setEditing(t.id)
                          }}
                          className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                        >
                          編輯
                        </button>
                        {pendingDeleteId === t.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                removeStockThesis(t.id)
                                setPendingDeleteId(null)
                                if (editing === t.id) setEditing(null)
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
                            onClick={() => setPendingDeleteId(t.id)}
                            className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                          >
                            刪除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          紀律：每季財報後 2 週內更新研究卡並逐條檢查失效條件；合理價只能因基本面事實調整，不能因股價上漲而上調。
        </p>
      </div>
    </div>
  )
}
