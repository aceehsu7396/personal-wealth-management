import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { prefillFromSearch } from '../lib/trades/tradeLink'
import { executionStats, slippageOf } from '../lib/trades/tradePlan'
import { useAppStore } from '../lib/storage/appStore'
import { useJourney } from '../lib/useJourney'
import { JourneyNotice } from '../components/JourneyNotice'
import { useChecklistContext } from '../lib/trades/useChecklistContext'
import { computeDiscipline, isException, type ReviewSlot } from '../lib/calculations/disciplineScore'
import { applyTradeToHoldings, TRADE_REASON_LABELS } from '../lib/calculations/preTradeChecklist'
import { isSatellite } from '../lib/calculations/portfolioRisk'
import { todayIsoDate } from '../lib/market/twse'
import { BrokerImport } from '../components/trades/BrokerImport'
import { TradeForm, type TradeSubmission } from '../components/forms/TradeForm'
import { TradeReviewForm } from '../components/forms/TradeReviewForm'
import { StatCard } from '../components/StatCard'
import { Disclosure, PageHeader, primaryButton } from '../components/ui'
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
  const strategies = useAppStore((s) => s.tradingStrategies)
  const { policy, journey } = useJourney()
  const addTrade = useAppStore((s) => s.addTrade)
  const updateTradePlan = useAppStore((s) => s.updateTradePlan)
  const updateTrade = useAppStore((s) => s.updateTrade)
  const removeTrade = useAppStore((s) => s.removeTrade)
  const addHolding = useAppStore((s) => s.addHolding)
  const updateHolding = useAppStore((s) => s.updateHolding)
  const updateStockThesis = useAppStore((s) => s.updateStockThesis)

  const [search, setSearch] = useSearchParams()
  // A research card or strategy card link opens the form pre-filled once.
  const [prefill] = useState(() => prefillFromSearch(search, holdings, theses, strategies))
  const [reviewing, setReviewing] = useState<string | null>(null)
  // The form opens on demand, or straight away when a plan or card filled it.
  const [formOpen, setFormOpen] = useState(prefill !== null)
  const openForm = () => {
    setFormOpen(true)
    requestAnimationFrame(() => document.getElementById('trade-form')?.scrollIntoView({ behavior: 'smooth' }))
  }
  useEffect(() => {
    if (prefill) requestAnimationFrame(() => document.getElementById('trade-form')?.scrollIntoView())
  }, [prefill])
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const ctx = useChecklistContext()
  const today = todayIsoDate()
  const plans = useAppStore((s) => s.tradePlans)
  const discipline = computeDiscipline(trades, holdings, theses, policy, today, plans)
  const execution = executionStats(plans, trades)
  const planById = new Map(plans.map((p) => [p.id, p]))
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
        strategyId: pending.strategyId,
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

    // A trade made from a plan moves the plan along: a buy opens it with the
    // actual fill, selling the whole position closes it.
    if (trade.planId) {
      const plan = useAppStore.getState().tradePlans.find((p) => p.id === trade.planId)
      if (plan && pending.side === 'buy' && plan.status === 'draft') {
        updateTradePlan(plan.id, {
          status: 'open',
          openedAt: trade.date,
          entryPrice: plan.entryPrice ?? pending.price,
          fillPrice: pending.price,
          shares: pending.shares,
          currentStop: plan.currentStop ?? plan.stopLoss,
        })
      } else if (plan && pending.side === 'sell') {
        const remaining = useAppStore.getState().holdings.find((h) => h.id === holdingId)?.shares ?? 0
        if (remaining <= 0) updateTradePlan(plan.id, { status: 'closed', closedAt: trade.date })
      }
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader
        title="交易日誌"
        summary="每筆交易先過檢核表，事後在 6 與 12 個月時檢討。評估的是流程，不是結果。"
        action={
          !formOpen && (
            <button type="button" className={primaryButton} onClick={() => openForm()}>
              記錄一筆交易
            </button>
          )
        }
      />

      <JourneyNotice
        missing={journey.missingForSatellite}
        intro="核心 ETF 的定期定額可以照常記錄；交易部位（衛星）的買進要先完成這些步驟，否則交易前檢核會標示未通過："
      />

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
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
        照計畫執行：交易部位的買進有計畫單 {execution.planned}/{execution.satelliteBuys} 筆
        {execution.avgSlippage !== null && `，平均滑價 ${execution.avgSlippage >= 0 ? '+' : ''}${(execution.avgSlippage * 100).toFixed(2)}%`}
        ，停損延遲 {execution.lateStops} 次{execution.lateStops > 0 && `（紀律分數 −${Math.min(execution.lateStops * 5, 20)}）`}。{' '}
        <Link to="/portfolio/plans" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          交易計畫
        </Link>
      </p>

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

      {formOpen && (
        <div className={cardClass} id="trade-form">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">記錄交易</h2>
            <button type="button" className="text-sm text-gray-500 hover:underline dark:text-gray-400" onClick={() => setFormOpen(false)}>
              收起
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            檢核依目前的投資政策、總經判斷、研究卡與持股即時計算。交易會同步更新持股的股數與平均成本。
          </p>
          <div className="mt-4">
            {prefill && (
              <p className="mb-3 rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200">
                已帶入 {prefill.ticker} 的{prefill.side === 'buy' ? '買進' : '賣出'}資料（理由：{TRADE_REASON_LABELS[prefill.reason]}）。請確認成交價、股數與日期，並回答偏誤自問；檢核未通過時要寫例外理由。
              </p>
            )}
            <TradeForm
              ctx={ctx}
              prefill={prefill}
              onSubmit={(submission) => {
                handleSubmit(submission)
                if (prefill) setSearch({}, { replace: true })
                setFormOpen(false)
              }}
            />
          </div>
        </div>
      )}

      <div className={cardClass}>
        <Disclosure summary="匯入券商對帳單（富邦證券成交明細 CSV）">
          <div className="mt-3">
            <BrokerImport onImport={handleSubmit} />
          </div>
        </Disclosure>
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
                  <th className="py-2 pr-4">計畫</th>
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
                      <td className="py-2 pr-4 text-xs text-gray-700 dark:text-gray-300">
                        {(() => {
                          const plan = t.planId ? planById.get(t.planId) : undefined
                          if (!plan) return '—'
                          const slip = slippageOf(t, plan)
                          return (
                            <Link to={`/portfolio/plans?id=${plan.id}`} className="hover:underline">
                              計畫 {plan.entryPrice ?? '—'}
                              {slip !== null && `・滑價 ${slip >= 0 ? '+' : ''}${(slip * 100).toFixed(2)}%`}
                            </Link>
                          )
                        })()}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {TRADE_REASON_LABELS[t.reason]}
                        {t.source === 'broker' && <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">券商匯入</span>}
                      </td>
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
