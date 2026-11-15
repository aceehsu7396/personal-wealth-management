import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { fetchStockData, type StockData, type StockRow } from '../lib/screener/stockData'
import {
  applyScreen,
  fieldValue,
  FIELDS,
  formatField,
  industries,
  PRESET_SCREENS,
  type NumericField,
  type RangeFilter,
  type Screen,
} from '../lib/screener/screens'
import { Term } from '../components/Term'
import { SortableTh } from '../components/SortableTh'
import { nextSort, sortRows, type SortState, type SortValue } from '../lib/sortRows'
import { ActionBadge } from '../components/research/SignalPanel'
import { evaluateThesis } from '../lib/calculations/thesisScoring'
import { useSignals } from '../lib/research/useSignals'
import { buyDistanceOf } from '../lib/research/signals'
import { inputClass, labelClass } from '../components/forms/FormField'
import { useEntrySignals } from '../lib/trades/useEntrySignals'
import { ENTRY_SIGNAL_LABELS } from '../lib/trades/entrySignals'
import { BATCH_SUGGESTED_MAX, draftThesis, researchBatch } from '../lib/research/batchResearch'
import { todayIsoDate } from '../lib/market/twse'
import { primaryButton, secondaryButton } from '../components/ui'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const thClass = 'py-2 pr-3 text-left text-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400'
const tdClass = 'py-1.5 pr-3 whitespace-nowrap text-gray-700 dark:text-gray-300'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'
const MAX_ROWS = 100

type ResultKey = 'code' | 'industry' | 'close' | NumericField
type WatchKey = 'code' | 'added' | 'change' | 'advice' | 'pe' | 'ret6m'

const COLUMNS: NumericField[] = ['pe', 'dividendYield', 'pb', 'revenueYoy', 'ret6m', 'ret12m', 'marketCap', 'tradeValue']

function Header({ field }: { field: NumericField }) {
  const def = FIELDS[field]
  const label = `${def.label}${def.unit ? `（${def.unit}）` : ''}`
  return def.glossary ? <Term name={def.glossary}>{label}</Term> : <>{label}</>
}

function StockActions({ row, onWatch, watched }: { row: StockRow; onWatch?: () => void; watched?: boolean }) {
  return (
    <span className="flex gap-2">
      {onWatch && (
        <button type="button" onClick={onWatch} disabled={watched} className={`${linkClass} disabled:text-gray-400 disabled:no-underline`}>
          {watched ? '已觀察' : '觀察'}
        </button>
      )}
      {!row.isEtf && (
        <Link to={`/research/stocks?new=${row.code}`} className={linkClass}>
          研究卡
        </Link>
      )}
      <Link to={`/sim/backtest?symbols=TW:${row.code}`} className={linkClass}>
        回測
      </Link>
    </span>
  )
}

export function ScreenerPage() {
  const watchlist = useAppStore((s) => s.watchlist)
  const entry = useEntrySignals()
  const addWatchItem = useAppStore((s) => s.addWatchItem)
  const updateWatchItem = useAppStore((s) => s.updateWatchItem)
  const removeWatchItem = useAppStore((s) => s.removeWatchItem)
  const theses = useAppStore((s) => s.stockTheses)
  const policy = useAppStore((s) => s.investmentPolicy)
  const addStockThesis = useAppStore((s) => s.addStockThesis)
  const navigate = useNavigate()
  const signalsFor = useSignals()
  // A watched symbol's research card, if one is written: its advice and how
  // far it is from the buy point.
  const cardAdvice = (symbol: string) => {
    const code = symbol.replace(/^TW:/, '')
    const thesis = theses.find((x) => x.ticker.trim().toUpperCase() === code && x.status !== 'exited')
    if (!thesis) return null
    if (!thesis.auto) return { code, signals: null, distance: null }
    const signals = signalsFor(thesis, evaluateThesis(thesis, policy))
    return { code, signals, distance: buyDistanceOf(signals, thesis.kind === 'etf') }
  }

  const [data, setData] = useState<StockData | null | undefined>(undefined)
  const [presetId, setPresetId] = useState<string>(PRESET_SCREENS[0].id)
  const [screen, setScreen] = useState<Screen>(PRESET_SCREENS[0].screen)
  const [customOpen, setCustomOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchStockData().then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const screened = useMemo(() => (data ? applyScreen(data.stocks, screen) : []), [data, screen])
  // Clicking a header re-sorts the matched rows; null keeps the screen's order.
  const [resultSort, setResultSort] = useState<SortState<ResultKey> | null>(null)
  const rows = useMemo(() => {
    if (!resultSort) return screened
    const key = resultSort.key
    const value = (r: StockRow): SortValue =>
      key === 'code' ? r.code : key === 'industry' ? r.industry : key === 'close' ? r.close : fieldValue(r, key)
    return sortRows(screened, value, resultSort.desc)
  }, [screened, resultSort])
  const sortResults = (key: ResultKey) => setResultSort((s) => nextSort(s, key, key !== 'code' && key !== 'industry'))
  const [watchSort, setWatchSort] = useState<SortState<WatchKey> | null>(null)
  const sortWatch = (key: WatchKey) => setWatchSort((s) => nextSort(s, key, key !== 'code' && key !== 'advice'))
  const bySymbol = useMemo(() => new Map((data?.stocks ?? []).map((s) => [`TW:${s.code}`, s])), [data])
  const preset = PRESET_SCREENS.find((p) => p.id === presetId)

  function pickPreset(id: string) {
    const p = PRESET_SCREENS.find((x) => x.id === id)
    if (!p) return
    setPresetId(id)
    setScreen(p.screen)
  }

  function edit(next: Partial<Screen>) {
    setPresetId('custom')
    setScreen({ ...screen, ...next })
  }

  function setBound(field: NumericField, key: 'min' | 'max', text: string) {
    const value = text.trim() === '' ? undefined : Number(text)
    const others = screen.filters.filter((f) => f.field !== field)
    const current: RangeFilter = screen.filters.find((f) => f.field === field) ?? { field }
    const next = { ...current, [key]: Number.isFinite(value) ? value : undefined }
    edit({ filters: next.min === undefined && next.max === undefined ? others : [...others, next] })
  }

  const bound = (field: NumericField, key: 'min' | 'max') => screen.filters.find((f) => f.field === field)?.[key] ?? ''

  function watch(row: StockRow) {
    addWatchItem({
      symbol: `TW:${row.code}`,
      name: row.name,
      industry: row.industry,
      priceAtAdd: row.close,
      source: preset ? `篩選：${preset.name}` : '篩選：自訂',
      note: '',
    })
  }

  // Ticked stocks to research in one go (handbook 06 §1).
  const [picked, setPicked] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [batch, setBatch] = useState<{ running: boolean; message: string } | null>(null)
  const carded = new Set(theses.map((t) => t.ticker.trim().toUpperCase()))
  const togglePick = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]))

  async function runBatch() {
    setConfirming(false)
    setBatch({ running: true, message: '準備中…' })
    const rowsByCode = new Map((data?.stocks ?? []).map((r) => [r.code, r]))
    const out = await researchBatch(picked, todayIsoDate(), {
      onProgress: (p) => setBatch({ running: true, message: `體檢 ${p.code}（${p.done + 1}/${p.total}，FinMind 免費資料）` }),
    })
    for (const { code, auto } of out.done) {
      addStockThesis(draftThesis(code, auto))
      const row = rowsByCode.get(code)
      if (row) watch(row)
    }
    const notes = [
      ...out.failed.map((f) => `${f.code}：${f.error}`),
      ...(out.pending.length > 0 ? [`${out.pending.join('、')} 尚未體檢，額度恢復後再勾選一次`] : []),
    ]
    if (out.done.length === 0) return setBatch({ running: false, message: notes.join('；') || '沒有完成任何一檔' })
    setPicked(out.pending)
    setBatch(notes.length > 0 ? { running: false, message: notes.join('；') } : null)
    navigate(`/research/stocks?batch=${out.done.map((d) => d.code).join(',')}`)
  }

  const watchedSymbols = new Set(watchlist.map((w) => w.symbol))
  const watchValue = (w: (typeof watchlist)[number], key: WatchKey): SortValue => {
    const row = bySymbol.get(w.symbol)
    if (key === 'code') return w.symbol.replace('TW:', '')
    if (key === 'added') return w.addedAt
    if (key === 'change') return row?.close && w.priceAtAdd ? row.close / w.priceAtAdd - 1 : null
    // Nearest buy point first when sorted ascending.
    if (key === 'advice') return cardAdvice(w.symbol)?.distance?.rank ?? null
    return row ? fieldValue(row, key) : null
  }
  const sortedWatchlist = watchSort ? sortRows(watchlist, (w) => watchValue(w, watchSort.key), watchSort.desc) : watchlist

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">選股</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        從台股上市公司與 ETF 中找候選：先套用一個篩選組合，把有興趣的加入觀察名單，再寫研究卡或直接回測。資料每天由 GitHub 從證交所開放資料更新（免 API 金鑰）。
      </p>


      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">篩選組合</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESET_SCREENS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickPreset(p.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                presetId === p.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-700'
              }`}
            >
              {p.name}
            </button>
          ))}
          {presetId === 'custom' && <span className="rounded-md bg-orange-100 px-3 py-1.5 text-sm text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">自訂</span>}
        </div>
        {preset && (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {preset.summary}{' '}
            <Link to={`/handbook/${preset.handbook}`} className={linkClass}>
              手冊 {preset.handbook}
            </Link>
          </p>
        )}

        <button type="button" onClick={() => setCustomOpen((v) => !v)} className={`${linkClass} mt-3`}>
          {customOpen ? '收合條件' : '調整條件'}
        </button>
        {customOpen && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(FIELDS) as NumericField[]).map((field) => (
              <div key={field}>
                <span className={labelClass}>
                  <Header field={field} />
                </span>
                <div className="flex items-center gap-1">
                  <input type="number" step="any" placeholder="最小" className={inputClass} value={bound(field, 'min')} onChange={(e) => setBound(field, 'min', e.target.value)} />
                  <input type="number" step="any" placeholder="最大" className={inputClass} value={bound(field, 'max')} onChange={(e) => setBound(field, 'max', e.target.value)} />
                </div>
              </div>
            ))}
            <label className="block">
              <span className={labelClass}>種類</span>
              <select className={inputClass} value={screen.kind} onChange={(e) => edit({ kind: e.target.value as Screen['kind'] })}>
                <option value="stock">只看股票</option>
                <option value="etf">只看 ETF</option>
                <option value="all">全部</option>
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>產業</span>
              <select className={inputClass} value={screen.industry ?? ''} onChange={(e) => edit({ industry: e.target.value || null })}>
                <option value="">全部產業</option>
                {industries(data?.stocks ?? []).map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>排序</span>
              <select className={inputClass} value={screen.sortBy} onChange={(e) => edit({ sortBy: e.target.value as NumericField })}>
                {(Object.keys(FIELDS) as NumericField[]).map((f) => (
                  <option key={f} value={f}>
                    {FIELDS[f].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>方向</span>
              <select className={inputClass} value={screen.sortDesc ? 'desc' : 'asc'} onChange={(e) => edit({ sortDesc: e.target.value === 'desc' })}>
                <option value="desc">由大到小</option>
                <option value="asc">由小到大</option>
              </select>
            </label>
          </div>
        )}

        <div className="mt-5">
          {data === undefined ? (
            <p className="text-sm text-gray-500">讀取每日股票資料中…</p>
          ) : data === null ? (
            <p className="text-sm text-orange-700 dark:text-orange-400">暫時讀不到每日股票資料，請稍後再試。</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {data.date} 收盤資料，共 {data.stocks.length} 檔，符合 {rows.length} 檔
                {rows.length > MAX_ROWS && `（顯示前 ${MAX_ROWS} 檔）`}。報酬未加回股利；上櫃股票不在範圍內。勾選個股可以一次建立研究卡，點欄位標題可以排序
                {resultSort ? (
                  <>
                    {'，'}
                    <button type="button" onClick={() => setResultSort(null)} className={linkClass}>
                      恢復篩選排序
                    </button>
                  </>
                ) : (
                  ''
                )}
                。
              </p>
              {(picked.length > 0 || batch) && (
                <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-100">
                  {batch ? (
                    <p>{batch.message}</p>
                  ) : confirming ? (
                    <>
                      <p>
                        將替 {picked.join('、')} 各建一張研究卡並自動體檢（財報、估值、技術面），完成後到研究卡逐張判定結論。資料來自 FinMind 免費額度，每小時有上限
                        {picked.length > BATCH_SUGGESTED_MAX ? `；一次超過 ${BATCH_SUGGESTED_MAX} 檔很可能用完，沒做完的會留著稍後再試` : ''}。
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" className={primaryButton} onClick={() => void runBatch()}>
                          確認開始研究
                        </button>
                        <button type="button" className={secondaryButton} onClick={() => setConfirming(false)}>
                          取消
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <span>已勾選 {picked.length} 檔：{picked.join('、')}</span>
                      <button type="button" className={primaryButton} onClick={() => setConfirming(true)}>
                        研究這 {picked.length} 檔
                      </button>
                      <button type="button" className={linkClass} onClick={() => setPicked([])}>
                        清除勾選
                      </button>
                    </div>
                  )}
                  {batch && !batch.running && (
                    <button type="button" className={`${linkClass} mt-1`} onClick={() => setBatch(null)}>
                      知道了
                    </button>
                  )}
                </div>
              )}
              <div className="mt-2 max-h-[32rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-gray-800">
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <SortableTh sortKey="code" label="代號" sort={resultSort} onSort={sortResults} className={`${thClass} sticky left-0 z-10 bg-white dark:bg-gray-800`}>
                        代號／名稱
                      </SortableTh>
                      <SortableTh sortKey="industry" label="產業" sort={resultSort} onSort={sortResults} className={thClass} />
                      <SortableTh sortKey="close" label="收盤" sort={resultSort} onSort={sortResults} className={thClass} />
                      {COLUMNS.map((c) => (
                        <SortableTh key={c} sortKey={c} label={FIELDS[c].label} sort={resultSort} onSort={sortResults} className={thClass}>
                          <Header field={c} />
                        </SortableTh>
                      ))}
                      <th className={thClass} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, MAX_ROWS).map((r) => (
                      <tr key={r.code} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                        <td className={`${tdClass} sticky left-0 bg-white dark:bg-gray-800`}>
                          {r.isEtf ? (
                            <span className="mr-2 inline-block w-4" />
                          ) : carded.has(r.code) ? (
                            <span className="mr-2 inline-block w-4 text-xs text-gray-400" title="已有研究卡">✓</span>
                          ) : (
                            <input
                              type="checkbox"
                              className="mr-2 align-middle"
                              aria-label={`勾選 ${r.code} 研究`}
                              checked={picked.includes(r.code)}
                              disabled={batch?.running}
                              onChange={() => togglePick(r.code)}
                            />
                          )}
                          <span className="font-medium text-gray-900 dark:text-gray-100">{r.code}</span> {r.name}
                        </td>
                        <td className={`${tdClass} text-xs`}>{r.industry}</td>
                        <td className={tdClass}>{r.close}</td>
                        {COLUMNS.map((c) => (
                          <td key={c} className={tdClass}>
                            {formatField(r, c)}
                          </td>
                        ))}
                        <td className={tdClass}>
                          <StockActions row={r} onWatch={() => watch(r)} watched={watchedSymbols.has(`TW:${r.code}`)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">觀察名單（{watchlist.length}）</h2>
          {watchlist.length >= 2 && (
            <Link
              to={`/sim/backtest?template=momentum_rotation&symbols=${watchlist.map((w) => w.symbol).join(',')}`}
              className={linkClass}
            >
              用觀察名單回測動能輪動
            </Link>
          )}
        </div>
        {watchlist.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            還沒有觀察中的標的。在上方結果按「觀察」加入；加入後會追蹤加入以來的漲跌，並可一鍵寫研究卡或回測。
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  {(
                    [
                      ['code', '代號／名稱'],
                      ['added', '加入'],
                      ['change', '加入以來'],
                      ['advice', '研究卡建議'],
                      ['pe', '本益比'],
                      ['ret6m', '6 個月'],
                    ] as [WatchKey, string][]
                  ).map(([k, h]) => (
                    <SortableTh key={k} sortKey={k} label={h} sort={watchSort} onSort={sortWatch} className={thClass} />
                  ))}
                  <th className={thClass}>進場條件</th>
                  <th className={thClass}>備註</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody>
                {sortedWatchlist.map((w) => {
                  const row = bySymbol.get(w.symbol)
                  const change = row?.close && w.priceAtAdd ? row.close / w.priceAtAdd - 1 : null
                  const advice = cardAdvice(w.symbol)
                  return (
                    <tr key={w.symbol} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                      <td className={tdClass}>
                        <span className="font-medium text-gray-900 dark:text-gray-100">{w.symbol.replace('TW:', '')}</span> {w.name}
                        <span className="block text-xs text-gray-600 dark:text-gray-400">{w.source}</span>
                      </td>
                      <td className={`${tdClass} text-xs`}>
                        {w.addedAt}
                        {w.priceAtAdd !== null && `・${w.priceAtAdd}`}
                      </td>
                      <td className={`${tdClass} ${change !== null && change < 0 ? 'text-orange-700 dark:text-orange-400' : ''}`}>
                        {change === null ? '—' : `${(change * 100).toFixed(1)}%`}
                      </td>
                      <td className={tdClass}>
                        {!advice ? (
                          <span className="text-xs text-gray-600 dark:text-gray-400">—</span>
                        ) : (
                          <Link to={`/research/stocks?new=${advice.code}`} className="flex items-center gap-1.5 hover:underline">
                            {advice.signals ? (
                              <>
                                <ActionBadge action={advice.signals.action} title={advice.signals.headline} />
                                <span className="text-xs">{advice.distance?.label}</span>
                              </>
                            ) : (
                              <span className="text-xs text-gray-500 dark:text-gray-400">尚未體檢</span>
                            )}
                          </Link>
                        )}
                      </td>
                      <td className={tdClass}>{row ? formatField(row, 'pe') : '—'}</td>
                      <td className={tdClass}>{row ? formatField(row, 'ret6m') : '—'}</td>
                      <td className={tdClass}>
                        {(() => {
                          const sigs = entry.items.find((x) => `${x.market}:${x.ticker}` === w.symbol || x.ticker === w.symbol)?.signals ?? []
                          if (sigs.length === 0) return <span className="text-xs text-gray-600 dark:text-gray-400">{entry.loading ? '讀取中' : '—'}</span>
                          return (
                            <span className="flex flex-wrap gap-1">
                              {sigs.map((sg) => (
                                <span key={sg.kind} title={sg.detail} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
                                  {ENTRY_SIGNAL_LABELS[sg.kind]}
                                </span>
                              ))}
                            </span>
                          )
                        })()}
                      </td>
                      <td className={tdClass}>
                        <input
                          className="w-40 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800"
                          defaultValue={w.note}
                          placeholder="為什麼觀察？"
                          onBlur={(e) => updateWatchItem(w.symbol, { note: e.target.value })}
                        />
                      </td>
                      <td className={tdClass}>
                        <span className="flex gap-2">
                          {row && <StockActions row={row} />}
                          <button type="button" onClick={() => removeWatchItem(w.symbol)} className="text-xs text-gray-600 hover:underline dark:text-gray-400">
                            移除
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
