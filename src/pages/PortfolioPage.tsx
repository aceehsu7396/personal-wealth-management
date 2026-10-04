import { useEffect, useState } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { useJourney } from '../lib/useJourney'
import { analyzePortfolio, isSatellite, SLEEVE_LABELS } from '../lib/calculations/portfolioRisk'
import { fetchLatestTwseClose, todayIsoDate } from '../lib/market/twse'
import { HoldingForm, type HoldingFormValues } from '../components/forms/HoldingForm'
import { RiskViolationList } from '../components/RiskViolationList'
import { PerformanceReviewPanel } from '../components/PerformanceReviewPanel'
import { PriceZoneBadge } from '../components/ThesisEvaluationView'
import { StatCard } from '../components/StatCard'
import { inputClass, labelClass } from '../components/forms/FormField'
import { formatCurrency, formatPercent } from '../lib/format'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const TWSE_TICKER = /^\d{4,6}[A-Z]?$/

export function PortfolioPage() {
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  // Satellite cap narrowed to the current learning stage.
  const { policy, learning } = useJourney()
  const guardrails = useAppStore((s) => s.guardrails)
  const meta = useAppStore((s) => s.portfolioMeta)
  const addHolding = useAppStore((s) => s.addHolding)
  const updateHolding = useAppStore((s) => s.updateHolding)
  const removeHolding = useAppStore((s) => s.removeHolding)
  const setPortfolioMeta = useAppStore((s) => s.setPortfolioMeta)
  const recordPortfolioValue = useAppStore((s) => s.recordPortfolioValue)
  const updateStockThesis = useAppStore((s) => s.updateStockThesis)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [priceFetch, setPriceFetch] = useState<{ state: 'idle' | 'loading' | 'done'; text?: string }>({
    state: 'idle',
  })

  const report = analyzePortfolio(holdings, theses, policy, guardrails, meta)
  const editing = editingId ? holdings.find((h) => h.id === editingId) : undefined

  useEffect(() => {
    if (report.totalValueTwd > 0) recordPortfolioValue(report.totalValueTwd, todayIsoDate())
  }, [report.totalValueTwd, recordPortfolioValue])

  // Keep the linked research card's price and status in step with the holding.
  function syncThesis(values: HoldingFormValues) {
    if (!values.thesisId || !isSatellite(values.sleeve)) return
    updateStockThesis(values.thesisId, {
      currentPrice: values.currentPrice,
      ...(values.shares > 0 ? { status: 'holding' as const } : {}),
    })
  }

  function handleSubmit(values: HoldingFormValues) {
    const withDate = { ...values, priceUpdatedAt: todayIsoDate() }
    if (editingId) {
      updateHolding(editingId, withDate)
      setEditingId(null)
    } else {
      addHolding(withDate)
    }
    syncThesis(values)
  }

  async function refreshTwsePrices() {
    const targets = holdings.filter((h) => h.currency === 'TWD' && TWSE_TICKER.test(h.ticker))
    if (targets.length === 0) {
      setPriceFetch({ state: 'done', text: '沒有可更新的上市台股代號。' })
      return
    }
    setPriceFetch({ state: 'loading' })
    const results = await Promise.allSettled(targets.map((h) => fetchLatestTwseClose(h.ticker)))
    let updated = 0
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled' || !r.value) return
      const h = targets[i]
      updateHolding(h.id, { currentPrice: r.value.close, priceUpdatedAt: r.value.date })
      syncThesis({ ...h, currentPrice: r.value.close })
      updated += 1
    })
    setPriceFetch({
      state: 'done',
      text: `已更新 ${updated}/${targets.length} 檔（上櫃股票與美股請手動輸入）。`,
    })
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">投資組合</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        組合建構與風險：配置偏離、單檔與產業集中度、匯率曝險、回撤熔斷與出場規則提醒。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="總市值" value={formatCurrency(report.totalValueTwd, 'TWD')} />
        <StatCard
          label="衛星比重"
          value={formatPercent(report.satellitePercent)}
          hint={`上限 ${policy.satellitePercent}%（學習階段${learning.title.split(' ')[0]}）`}
        />
        <StatCard
          label="美元曝險"
          value={formatPercent(report.usdExposurePercent)}
          hint={`上限 ${policy.maxUsdExposurePercent}%`}
        />
        <StatCard
          label="自高點回撤"
          value={formatPercent(report.drawdownPercent)}
          hint={`熔斷 −${policy.drawdownCircuitBreakerPercent}%`}
        />
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">風控警示</h2>
        <div className="mt-4">
          <RiskViolationList
            violations={report.violations}
            emptyMessage={holdings.length === 0 ? '新增持股後開始監控。' : '目前沒有違反任何風控規則。'}
          />
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">配置與目標對比</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="py-2 pr-4">層級</th>
                <th className="py-2 pr-4">市值</th>
                <th className="py-2 pr-4">實際</th>
                <th className="py-2 pr-4">目標</th>
                <th className="py-2 pr-4">偏離</th>
              </tr>
            </thead>
            <tbody>
              {report.sleeves.map((s) => (
                <tr key={s.sleeve} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{SLEEVE_LABELS[s.sleeve]}</td>
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                    {formatCurrency(s.valueTwd, 'TWD')}
                  </td>
                  <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{formatPercent(s.actualPercent)}</td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {s.effectiveTargetPercent === null ? '—' : formatPercent(s.effectiveTargetPercent)}
                  </td>
                  <td
                    className={`py-2 pr-4 ${
                      s.driftPoints !== null && Math.abs(s.driftPoints) > guardrails.rebalancingBandPercent
                        ? 'font-medium text-orange-700 dark:text-orange-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {s.driftPoints === null ? '—' : `${s.driftPoints > 0 ? '+' : ''}${s.driftPoints.toFixed(1)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          核心目標依投資政策比例，並把尚未使用的衛星額度按比例分給核心。衛星合計上限 {policy.satellitePercent}%（依學習階段調整）。
          {report.sectorExposure.length > 0 &&
            ` 各產業占衛星額度：${report.sectorExposure
              .map((e) => `${e.sector} ${e.percentOfSatelliteBudget.toFixed(0)}%`)
              .join('、')}。`}
        </p>
      </div>

      <div className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">持股</h2>
          <button
            type="button"
            onClick={refreshTwsePrices}
            disabled={priceFetch.state === 'loading'}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {priceFetch.state === 'loading' ? '更新中…' : '更新上市台股收盤價'}
          </button>
        </div>
        {priceFetch.text && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{priceFetch.text}</p>}
        {report.holdings.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">還沒有持股。</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-2 pr-4">標的</th>
                  <th className="py-2 pr-4">市值（新台幣）</th>
                  <th className="py-2 pr-4">權重</th>
                  <th className="py-2 pr-4">損益</th>
                  <th className="py-2 pr-4">價位</th>
                  <th className="py-2 pr-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {[...report.holdings]
                  .sort((a, b) => b.valueTwd - a.valueTwd)
                  .map((v) => (
                    <tr key={v.holding.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                      <td className="py-2 pr-4">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {v.holding.ticker} {v.holding.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {SLEEVE_LABELS[v.holding.sleeve]}
                          {v.holding.priceUpdatedAt && `・價格 ${v.holding.priceUpdatedAt}`}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {formatCurrency(v.valueTwd, 'TWD')}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {formatPercent(v.weightPercent)}
                        {v.positionCapPercent !== null && (
                          <span className="text-xs text-gray-400"> / {v.positionCapPercent}%</span>
                        )}
                      </td>
                      <td
                        className={`py-2 pr-4 ${
                          v.gainPercent >= 0
                            ? 'text-indigo-700 dark:text-indigo-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {v.gainPercent >= 0 ? '+' : ''}
                        {formatPercent(v.gainPercent)}
                      </td>
                      <td className="py-2 pr-4">
                        {v.thesisEvaluation ? <PriceZoneBadge zone={v.thesisEvaluation.priceZone} /> : '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDeleteId(null)
                              setEditingId(v.holding.id)
                            }}
                            className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                          >
                            編輯
                          </button>
                          {pendingDeleteId === v.holding.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  removeHolding(v.holding.id)
                                  setPendingDeleteId(null)
                                  if (editingId === v.holding.id) setEditingId(null)
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
                              onClick={() => setPendingDeleteId(v.holding.id)}
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

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {editing ? `編輯持股：${editing.ticker}` : '新增持股'}
        </h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          現金可新增為「核心：債券/現金」，股數填金額、成本與現價填 1。
        </p>
        <div className="mt-4">
          <HoldingForm
            key={editingId ?? 'new'}
            theses={theses}
            initialValues={editing}
            onSubmit={handleSubmit}
            onCancel={editing ? () => setEditingId(null) : undefined}
          />
        </div>
      </div>

      <PerformanceReviewPanel report={report} />

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">組合設定</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>美元兌台幣匯率</span>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              defaultValue={meta.fxUsdTwd}
              onChange={(e) => {
                const value = Number(e.target.value)
                if (Number.isFinite(value) && value > 0) setPortfolioMeta({ fxUsdTwd: value })
              }}
            />
          </label>
          <div>
            <span className={labelClass}>組合市值高點（用於回撤熔斷）</span>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {formatCurrency(meta.peakValueTwd, 'TWD')}
              {meta.peakDate && <span className="text-xs text-gray-500"> （{meta.peakDate}）</span>}
            </p>
            <button
              type="button"
              onClick={() => setPortfolioMeta({ peakValueTwd: report.totalValueTwd, peakDate: todayIsoDate() })}
              className="mt-1 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
            >
              以目前市值重設高點
            </button>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              高點包含新投入的資金；大筆投入或提領後可重設，以免回撤被低估或高估。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
