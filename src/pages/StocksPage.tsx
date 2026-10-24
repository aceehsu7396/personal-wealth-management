import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchStockData } from '../lib/screener/stockData'
import { useAppStore } from '../lib/storage/appStore'
import { useJourney } from '../lib/useJourney'
import { AutoRatingBar } from '../components/research/AutoRatingBar'
import { JourneyNotice } from '../components/JourneyNotice'
import {
  evaluateThesis,
  LYNCH_LABELS,
  STATUS_LABELS,
  VERDICT_LABELS,
} from '../lib/calculations/thesisScoring'
import { StockThesisForm, type StockThesisFormValues } from '../components/forms/StockThesisForm'
import { isStale, refreshedFields, refreshTechnical, technicalStale } from '../lib/research/autoResearch'
import { useSignals } from '../lib/research/useSignals'
import { ActionBadge } from '../components/research/SignalPanel'
import { todayIsoDate } from '../lib/market/twse'
import { describeAiError } from '../lib/ai/client'
import { PriceZoneBadge } from '../components/ThesisEvaluationView'
import { useTwseAutoRefresh } from '../lib/market/useTwseAutoRefresh'
import { StatCard } from '../components/StatCard'
import type { ThesisStatus } from '../lib/storage/schema'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'

type Filter = ThesisStatus | 'all'

export function StocksPage() {
  const theses = useAppStore((s) => s.stockTheses)
  const policy = useAppStore((s) => s.investmentPolicy)
  const { journey } = useJourney()
  // Daily TWSE price/valuation refresh for Taiwan research cards.
  useTwseAutoRefresh()
  const addStockThesis = useAppStore((s) => s.addStockThesis)
  const updateStockThesis = useAppStore((s) => s.updateStockThesis)
  const removeStockThesis = useAppStore((s) => s.removeStockThesis)

  // null = form closed, 'new' = creating, otherwise the id being edited
  const [search, setSearch] = useSearchParams()
  const newCode = search.get('new')
  const [editing, setEditing] = useState<string | null>(newCode ? 'new' : null)
  // Started from the screener (?new=2330): prefill from the daily data.
  const [prefill, setPrefill] = useState<{ ticker: string; name: string; sector: string; currentPrice?: number }>()
  useEffect(() => {
    if (!newCode) return
    const existing = theses.find((t) => t.ticker === newCode)
    if (existing) {
      setEditing(existing.id)
      setSearch({}, { replace: true })
      return
    }
    void fetchStockData().then((data) => {
      const row = data?.stocks.find((s) => s.code === newCode)
      setPrefill({ ticker: newCode, name: row?.name ?? '', sector: row?.industry ?? '', currentPrice: row?.close ?? undefined })
      setSearch({}, { replace: true })
    })
  }, [newCode, theses, setSearch])
  // A prefill applies only to the card it was opened for.
  useEffect(() => {
    if (editing === null) setPrefill(undefined)
  }, [editing])
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const signalsFor = useSignals()
  const editingThesis =
    editing && editing !== 'new' ? theses.find((t) => t.id === editing) : undefined
  const evaluated = theses
    .filter((t) => filter === 'all' || t.status === filter)
    .map((t) => {
      const evaluation = evaluateThesis(t, policy)
      return { thesis: t, evaluation, signals: t.auto ? signalsFor(t, evaluation) : null }
    })
    .sort((a, b) => b.evaluation.convictionScore - a.evaluation.convictionScore)

  const active = theses.filter((t) => t.status !== 'exited')
  const activeEvaluations = active.map((t) => evaluateThesis(t, policy))
  const inBuyZone = activeEvaluations.filter(
    (e) => e.priceZone === 'buy' || e.priceZone === 'strong_buy',
  ).length
  const incomplete = activeEvaluations.filter((e) => !e.isComplete).length
  const strong = activeEvaluations.filter((e) => e.rating?.overall === 'strong').length
  const needTrim = theses
    .filter((t) => t.status === 'holding')
    .map((t) => evaluateThesis(t, policy))
    .filter((e) => e.priceZone === 'trim' || e.priceZone === 'exit_overvalued').length

  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  async function refresh(id: string) {
    const t = useAppStore.getState().stockTheses.find((x) => x.id === id)
    if (!t || t.market !== 'TW') return
    setRefreshing(id)
    try {
      updateStockThesis(id, await refreshedFields(t, todayIsoDate()))
      setRefreshError(null)
    } catch (e) {
      setRefreshError(`${t.ticker}：${describeAiError(e)}`)
    } finally {
      setRefreshing(null)
    }
  }

  // Health checks older than a week refresh in the background, and the
  // other cards get today's prices for the entry/exit signals (a few per
  // visit, to stay within the free data quota).
  useEffect(() => {
    const today = todayIsoDate()
    const live = useAppStore.getState().stockTheses.filter((t) => t.market === 'TW' && t.status !== 'exited')
    const stale = live.filter((t) => isStale(t.auto, today)).slice(0, 5)
    const pricesOnly = live.filter((t) => !stale.includes(t) && technicalStale(t.auto, today)).slice(0, 10)
    if (stale.length + pricesOnly.length === 0) return
    let cancelled = false
    void (async () => {
      try {
        for (const t of stale) {
          if (cancelled) return
          updateStockThesis(t.id, await refreshedFields(t, today))
        }
        for (const t of pricesOnly) {
          if (cancelled || !t.auto) return
          const { technical, technicalAt, price, priceDate } = await refreshTechnical(t.ticker, today)
          if (cancelled) return
          const current = useAppStore.getState().stockTheses.find((x) => x.id === t.id)
          if (!current?.auto) continue
          updateStockThesis(t.id, {
            auto: { ...current.auto, technical, technicalAt, price: price ?? current.auto.price, priceDate: priceDate ?? current.auto.priceDate },
            currentPrice: price ?? current.currentPrice,
          })
        }
      } catch {
        return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [updateStockThesis])

  function handleSubmit(values: StockThesisFormValues) {
    if (editingThesis) updateStockThesis(editingThesis.id, values)
    else addStockThesis(values)
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">個股</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        輸入台股或 ETF 代號，研究卡會自動體檢（免費公開資料、不用 AI）並給出觀察評等；你只要選結論。結論為「值得投資」且通過檢核，才進入交易部位建倉。
      </p>

      <JourneyNotice
        missing={journey.missingForSatellite}
        intro="研究卡隨時可以建立來觀察；實單買進前，建議先完成這些步驟："
      />

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="研究中標的" value={`${active.length}`} hint="觀察 + 持有" />
        <StatCard label="評等體質佳" value={`${strong}`} hint="各面向都沒有留意項目" />
        <StatCard label="進入買進區" value={`${inBuyZone}`} hint={needTrim > 0 ? `持股 ${needTrim} 檔進入減碼區` : undefined} />
        <StatCard label="待選結論" value={`${incomplete}`} hint="選了結論才能建倉" />
      </div>


      {editing ? (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingThesis ? `編輯研究卡：${editingThesis.ticker}` : '新增研究卡'}
          </h2>
          <div className="mt-4">
            <StockThesisForm
              key={`${editing}${prefill?.ticker ?? ''}`}
              prefill={editingThesis ? undefined : prefill}
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
        {refreshError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{refreshError}</p>}
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
                  <th className="py-2 pr-4">觀察評等</th>
                  <th className="py-2 pr-4">結論</th>
                  <th className="py-2 pr-4">現價 / 基準合理價</th>
                  <th className="py-2 pr-4">本益比位置</th>
                  <th className="py-2 pr-4">價位</th>
                  <th className="py-2 pr-4">建議</th>
                  <th className="py-2 pr-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {evaluated.map(({ thesis: t, evaluation: e, signals }) => (
                  <tr key={t.id} className="border-b border-gray-100 align-top last:border-0 dark:border-gray-700">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {t.ticker} {t.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {t.kind === 'etf' ? 'ETF' : `${t.sector}・${LYNCH_LABELS[e.lynchCategory]}`}・{STATUS_LABELS[t.status]}
                      </div>
                      {t.market === 'TW' ? (
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          {t.auto ? `體檢 ${t.auto.fetchedAt.slice(0, 10)}` : '尚未體檢'}
                          {' · '}
                          <button
                            type="button"
                            disabled={refreshing !== null}
                            onClick={() => void refresh(t.id)}
                            className="font-medium text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-400"
                          >
                            {refreshing === t.id ? '更新中…' : '更新體檢'}
                          </button>
                        </div>
                      ) : (
                        <div className="text-xs text-orange-700 dark:text-orange-400">美股：無自動資料</div>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {e.rating ? <AutoRatingBar rating={e.rating} compact /> : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="py-2 pr-4">
                      {t.verdict ? (
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            t.verdict === 'invest'
                              ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300'
                              : t.verdict === 'pass'
                                ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                          }`}
                          title={t.verdictNote}
                        >
                          {VERDICT_LABELS[t.verdict]}
                        </span>
                      ) : (
                        <span className="text-xs text-orange-700 dark:text-orange-400">待選結論</span>
                      )}
                      {t.verdictNote && <div className="mt-1 max-w-40 text-xs text-gray-500 dark:text-gray-400">{t.verdictNote}</div>}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-gray-700 dark:text-gray-300">
                      {t.currentPrice}
                      {t.kind !== 'etf' && t.fairValueBase > 0 && ` / ${t.fairValueBase.toFixed(1)}`}
                    </td>
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                      {t.auto?.stock?.valuation.pe?.percentile != null ? `第 ${t.auto.stock.valuation.pe.percentile} 百分位` : '—'}
                    </td>
                    <td className="py-2 pr-4">
                      {t.kind === 'etf' || !t.auto ? <span className="text-xs text-gray-400">—</span> : <PriceZoneBadge zone={e.priceZone} />}
                    </td>
                    <td className="py-2 pr-4">
                      {signals ? (
                        <>
                          <ActionBadge action={signals.action} title={signals.headline} />
                          <div className="mt-1 max-w-48 text-xs text-gray-500 dark:text-gray-400">{signals.headline}</div>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
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
