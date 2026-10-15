import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { fetchStockData, type StockData, type StockRow } from '../lib/screener/stockData'
import {
  applyScreen,
  FIELDS,
  formatField,
  industries,
  PRESET_SCREENS,
  type NumericField,
  type RangeFilter,
  type Screen,
} from '../lib/screener/screens'
import { SimGuide } from '../components/SimGuide'
import { Term } from '../components/Term'
import { inputClass, labelClass } from '../components/forms/FormField'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const thClass = 'py-2 pr-3 text-left text-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400'
const tdClass = 'py-1.5 pr-3 whitespace-nowrap text-gray-700 dark:text-gray-300'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'
const MAX_ROWS = 100

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
  const addWatchItem = useAppStore((s) => s.addWatchItem)
  const updateWatchItem = useAppStore((s) => s.updateWatchItem)
  const removeWatchItem = useAppStore((s) => s.removeWatchItem)

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

  const rows = useMemo(() => (data ? applyScreen(data.stocks, screen) : []), [data, screen])
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

  const watchedSymbols = new Set(watchlist.map((w) => w.symbol))

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">選股</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        從台股上市公司與 ETF 中找候選：先套用一個篩選組合，把有興趣的加入觀察名單，再寫研究卡或直接回測。資料每天由 GitHub 從證交所開放資料更新（免 API 金鑰）。
      </p>

      <SimGuide />

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
                  : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700'
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
                {rows.length > MAX_ROWS && `（顯示前 ${MAX_ROWS} 檔）`}。報酬未加回股利；上櫃股票不在範圍內。
              </p>
              <div className="mt-2 max-h-[32rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-gray-800">
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className={`${thClass} sticky left-0 z-10 bg-white dark:bg-gray-800`}>代號／名稱</th>
                      <th className={thClass}>產業</th>
                      <th className={thClass}>收盤</th>
                      {COLUMNS.map((c) => (
                        <th key={c} className={thClass}>
                          <Header field={c} />
                        </th>
                      ))}
                      <th className={thClass} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, MAX_ROWS).map((r) => (
                      <tr key={r.code} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                        <td className={`${tdClass} sticky left-0 bg-white dark:bg-gray-800`}>
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
                  {['代號／名稱', '加入', '加入以來', '本益比', '6 個月', '備註', ''].map((h) => (
                    <th key={h} className={thClass}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {watchlist.map((w) => {
                  const row = bySymbol.get(w.symbol)
                  const change = row?.close && w.priceAtAdd ? row.close / w.priceAtAdd - 1 : null
                  return (
                    <tr key={w.symbol} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                      <td className={tdClass}>
                        <span className="font-medium text-gray-900 dark:text-gray-100">{w.symbol.replace('TW:', '')}</span> {w.name}
                        <span className="block text-xs text-gray-400">{w.source}</span>
                      </td>
                      <td className={`${tdClass} text-xs`}>
                        {w.addedAt}
                        {w.priceAtAdd !== null && `・${w.priceAtAdd}`}
                      </td>
                      <td className={`${tdClass} ${change !== null && change < 0 ? 'text-orange-700 dark:text-orange-400' : ''}`}>
                        {change === null ? '—' : `${(change * 100).toFixed(1)}%`}
                      </td>
                      <td className={tdClass}>{row ? formatField(row, 'pe') : '—'}</td>
                      <td className={tdClass}>{row ? formatField(row, 'ret6m') : '—'}</td>
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
                          <button type="button" onClick={() => removeWatchItem(w.symbol)} className="text-xs text-gray-500 hover:underline">
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
