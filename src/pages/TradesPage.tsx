import { useState } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { assessMacro } from '../lib/calculations/macroRegime'
import { computeDiscipline, isException, type ReviewSlot } from '../lib/calculations/disciplineScore'
import { applyTradeToHoldings, TRADE_REASON_LABELS } from '../lib/calculations/preTradeChecklist'
import { isSatellite } from '../lib/calculations/portfolioRisk'
import { todayIsoDate } from '../lib/market/twse'
import { TradeForm, type TradeSubmission } from '../components/forms/TradeForm'
import { TradeReviewForm } from '../components/forms/TradeReviewForm'
import { StatCard } from '../components/StatCard'
import { formatPercent } from '../lib/format'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'

const SLOT_LABELS: Record<ReviewSlot, string> = { review6m: '6 個月檢討', review12m: '12 個月檢討' }

function rate(value: number | null): string {
  return value === null ? '—' : formatPercent(value, 0)
}

export function TradesPage() {
  const trades = useAppStore((s) => s.trades)
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  const policy = useAppStore((s) => s.investmentPolicy)
  const guardrails = useAppStore((s) => s.guardrails)
  const meta = useAppStore((s) => s.portfolioMeta)
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const addTrade = useAppStore((s) => s.addTrade)
  const updateTrade = useAppStore((s) => s.updateTrade)
  const removeTrade = useAppStore((s) => s.removeTrade)
  const addHolding = useAppStore((s) => s.addHolding)
  const updateHolding = useAppStore((s) => s.updateHolding)
  const updateStockThesis = useAppStore((s) => s.updateStockThesis)

  const [reviewing, setReviewing] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const latestMacro = [...macroCheckIns].sort((a, b) => b.date.localeCompare(a.date))[0]
  const ctx = {
    holdings,
    theses,
    policy,
    guardrails,
    meta,
    macro: latestMacro ? assessMacro(latestMacro, guardrails) : null,
  }
  const today = todayIsoDate()
  const discipline = computeDiscipline(trades, holdings, theses, policy, today)
  const sortedTrades = [...trades].sort((a, b) => b.date.localeCompare(a.date))

  function handleSubmit({ trade, pending }: TradeSubmission) {
    let holdingId = pending.holdingId
    if (holdingId) {
      const updated = applyTradeToHoldings(holdings, pending).find((h) => h.id === holdingId)
      if (updated) {
        updateHolding(holdingId, {
          shares: updated.shares,
          avgCost: updated.avgCost,
          currentPrice: updated.currentPrice,
          priceUpdatedAt: trade.date,
        })
      }
    } else if (pending.side === 'buy') {
      holdingId = addHolding({
        ticker: pending.ticker,
        name: pending.name,
        sleeve: pending.sleeve,
        currency: pending.currency,
        shares: pending.shares,
        avgCost: pending.price,
        currentPrice: pending.price,
        thesisId: pending.thesisId,
        priceUpdatedAt: trade.date,
      })
    }

    if (pending.thesisId && isSatellite(pending.sleeve)) {
      const remaining = useAppStore.getState().holdings.find((h) => h.id === holdingId)?.shares ?? 0
      updateStockThesis(pending.thesisId, {
        currentPrice: pending.price,
        status: remaining > 0 ? 'holding' : 'exited',
      })
    }

    addTrade({ ...trade, holdingId })
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">交易日誌</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        每筆交易先過檢核表，事後在 6 與 12 個月時檢討。評估的是流程，不是結果。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="紀律分數"
          value={discipline.score === null ? '—' : `${discipline.score}`}
          hint={discipline.tier}
        />
        <StatCard
          label="依規交易比例"
          value={rate(discipline.complianceRate)}
          hint={`例外 ${discipline.exceptionTrades.length} 筆（權重 40%）`}
        />
        <StatCard label="研究卡完整度" value={rate(discipline.thesisCompletenessRate)} hint="衛星持股（權重 30%）" />
        <StatCard
          label="檢討完成率"
          value={rate(discipline.reviewCompletionRate)}
          hint={`待檢討 ${discipline.pendingReviews.length} 筆（權重 30%）`}
        />
      </div>

      {discipline.pendingReviews.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">待完成的事後檢討</h2>
          <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-700">
            {discipline.pendingReviews.map(({ trade, slot, dueDate }) => {
              const key = `${trade.id}:${slot}`
              return (
                <li key={key} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-gray-700 dark:text-gray-300">
                      {trade.date} {trade.side === 'buy' ? '買進' : '賣出'} {trade.ticker} {trade.name}・
                      {TRADE_REASON_LABELS[trade.reason]}
                    </span>
                    <span className="text-xs text-orange-700 dark:text-orange-400">
                      {SLOT_LABELS[slot]}（{dueDate} 到期）
                    </span>
                  </div>
                  {reviewing === key ? (
                    <TradeReviewForm
                      onSubmit={(review) => {
                        updateTrade(trade.id, { [slot]: review })
                        setReviewing(null)
                      }}
                      onCancel={() => setReviewing(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReviewing(key)}
                      className="mt-1 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                    >
                      開始檢討
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">記錄交易</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          檢核依目前的投資政策、總經判斷、研究卡與持股即時計算。交易會同步更新持股的股數與平均成本。
        </p>
        <div className="mt-4">
          <TradeForm ctx={ctx} onSubmit={handleSubmit} />
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">交易紀錄</h2>
        {sortedTrades.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">還沒有交易紀錄。</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-2 pr-4">日期</th>
                  <th className="py-2 pr-4">標的</th>
                  <th className="py-2 pr-4">交易</th>
                  <th className="py-2 pr-4">理由</th>
                  <th className="py-2 pr-4">檢核</th>
                  <th className="py-2 pr-4">檢討</th>
                  <th className="py-2 pr-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedTrades.map((t) => {
                  const passed = t.checklist.filter((c) => c.passed).length
                  return (
                    <tr key={t.id} className="border-b border-gray-100 align-top last:border-0 dark:border-gray-700">
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{t.date}</td>
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                        {t.ticker} {t.name}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {t.side === 'buy' ? '買' : '賣'} {t.shares} @ {t.price} {t.currency === 'USD' ? '美元' : '新台幣'}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{TRADE_REASON_LABELS[t.reason]}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            isException(t)
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-indigo-700 dark:text-indigo-400'
                          }
                          title={t.exceptionReason}
                        >
                          {passed}/{t.checklist.length}
                          {isException(t) && '（例外）'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-gray-500 dark:text-gray-400">
                        {t.review6m ? '6 個月 ✓' : '6 個月 —'}・{t.review12m ? '12 個月 ✓' : '12 個月 —'}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {pendingDeleteId === t.id ? (
                          <span className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                removeTrade(t.id)
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
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(t.id)}
                            className="text-xs font-medium text-gray-500 hover:underline dark:text-gray-400"
                          >
                            刪除
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          刪除交易紀錄不會回復持股；若是輸入錯誤，請到投資組合頁手動修正持股。
        </p>
      </div>
    </div>
  )
}
