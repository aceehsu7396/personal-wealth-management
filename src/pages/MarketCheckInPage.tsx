import { useEffect, useState } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { computeAdvice } from '../lib/calculations/adviceRules'
import { fetchRecentTaiexAndTw0050, todayIsoDate } from '../lib/market/twse'
import { isReviewDue } from '../lib/reviewSchedule'
import { MarketPriceChart } from '../components/charts/MarketPriceChart'
import { AdviceSummary } from '../components/AdviceSummary'
import { AiResearchSummary } from '../components/AiResearchSummary'
import { MacroPanel } from '../components/MacroPanel'
import {
  MarketCheckInForm,
  MARKET_PHASE_LABELS,
  VALUATION_ZONE_LABELS,
  INTEREST_RATE_LABELS,
  type MarketCheckInFormValues,
} from '../components/forms/MarketCheckInForm'

export function MarketCheckInPage() {
  const marketPriceHistory = useAppStore((s) => s.marketPriceHistory)
  const marketCheckIns = useAppStore((s) => s.marketCheckIns)
  const guardrails = useAppStore((s) => s.guardrails)
  const addMarketCheckIn = useAppStore((s) => s.addMarketCheckIn)
  const updateMarketCheckIn = useAppStore((s) => s.updateMarketCheckIn)
  const removeMarketCheckIn = useAppStore((s) => s.removeMarketCheckIn)
  const mergeMarketPriceHistory = useAppStore((s) => s.mergeMarketPriceHistory)

  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (marketPriceHistory.lastFetchedDate === todayIsoDate()) return
    setFetchState('loading')
    fetchRecentTaiexAndTw0050()
      .then(({ taiex, tw0050 }) => {
        mergeMarketPriceHistory(taiex, tw0050, todayIsoDate())
        setFetchState('idle')
      })
      .catch((error) => {
        console.warn('[MarketCheckInPage] 更新 TWSE 收盤價失敗', error)
        setFetchState('error')
      })
    // only run once on mount; re-fetching is gated by lastFetchedDate anyway
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sortedCheckIns = [...marketCheckIns].sort((a, b) => b.date.localeCompare(a.date))
  const latestCheckIn = sortedCheckIns[0]
  const advice = latestCheckIn ? computeAdvice(latestCheckIn, guardrails) : null
  const editingCheckIn = editingId
    ? marketCheckIns.find((c) => c.id === editingId)
    : undefined

  const reviewDue = isReviewDue(latestCheckIn?.date, guardrails.reviewCadenceMonths)

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        市場檢視與建議
      </h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        參考大盤與 0050 收盤價走勢，手動評估市場狀況，取得長期配置建議。
      </p>

      {reviewDue && (
        <div className="mt-6 rounded-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
          {latestCheckIn
            ? `距離上次評估已超過 ${guardrails.reviewCadenceMonths} 個月，建議新增一筆市場檢視。`
            : '還沒有任何市場評估，建議新增第一筆。'}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        {fetchState === 'loading' && (
          <p className="mb-3 text-xs text-gray-400">正在向證交所更新今日收盤價…</p>
        )}
        {fetchState === 'error' && (
          <p className="mb-3 text-xs text-red-500">
            更新收盤價失敗，顯示上次快取的資料。
          </p>
        )}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <MarketPriceChart
            data={marketPriceHistory.taiex}
            label="大盤（發行量加權股價指數）"
            color="#4f46e5"
            gradientId="taiexFill"
          />
          <MarketPriceChart
            data={marketPriceHistory.tw0050}
            label="0050"
            color="#f97316"
            gradientId="tw0050Fill"
          />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          AI 研究摘要
        </h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          依大盤與 0050 收盤價自動產生的描述性摘要，輔助你自行判斷估值區間，不是進出場訊號。
        </p>
        <div className="mt-4">
          <AiResearchSummary
            taiex={marketPriceHistory.taiex}
            tw0050={marketPriceHistory.tw0050}
            latestCheckIn={latestCheckIn}
          />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">目前建議</h2>
        <div className="mt-4">
          <AdviceSummary
            advice={advice}
            emptyMessage="新增第一筆市場評估後，這裡會顯示對應的長期配置建議。"
          />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {editingCheckIn ? '編輯市場評估' : '新增市場評估'}
        </h2>
        <div className="mt-4">
          <MarketCheckInForm
            key={editingId ?? 'new'}
            initialValues={editingCheckIn}
            onSubmit={(values: MarketCheckInFormValues) => {
              if (editingId) {
                updateMarketCheckIn(editingId, values)
                setEditingId(null)
              } else {
                addMarketCheckIn(values)
              }
            }}
            onCancel={editingCheckIn ? () => setEditingId(null) : undefined}
          />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">歷史評估</h2>
        {sortedCheckIns.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            還沒有任何紀錄，新增第一筆吧。
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-2 pr-4">日期</th>
                  <th className="py-2 pr-4">市場階段</th>
                  <th className="py-2 pr-4">估值區間</th>
                  <th className="py-2 pr-4">利率水準</th>
                  <th className="py-2 pr-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedCheckIns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-700"
                  >
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{c.date}</td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {MARKET_PHASE_LABELS[c.marketPhase]}
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {VALUATION_ZONE_LABELS[c.valuationZone]}
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {INTEREST_RATE_LABELS[c.interestRateLevel]}
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
                                removeMarketCheckIn(c.id)
                                setPendingDeleteId(null)
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MacroPanel />
    </div>
  )
}
