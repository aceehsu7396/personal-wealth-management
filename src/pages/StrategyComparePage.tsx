import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import type { BacktestStats, CompareEntry, StrategyComparison, StrategyTemplate } from '../lib/storage/schema'
import {
  COMPARABLE_TEMPLATES,
  priorTrialsFor,
  runComparison,
  summarizeComparison,
  toSavedRows,
} from '../lib/backtest/compare'
import { marketCosts, type ChipSeries } from '../lib/backtest/engine'
import { loadChipData, loadPriceData } from '../lib/backtest/data'
import { STRATEGY_TEMPLATES, defaultParams, formatSymbol, parseSymbolList } from '../lib/backtest/templates'
import { calmarOf } from '../lib/backtest/passRule'
import { compareEntriesOf, useLibrary, withCompareSet } from '../lib/backtest/library'
import { thesisForCode } from '../lib/research/strategyLink'
import { VERDICT_LABELS } from '../lib/calculations/thesisScoring'
import { isoDaysAgo, type Bar } from '../lib/market/priceHistory'
import { todayIsoDate } from '../lib/market/twse'
import { describeAiError } from '../lib/ai/client'
import { CompareChart } from '../components/charts/CompareChart'
import { Field, inputClass } from '../components/forms/FormField'
import { SimGuide } from '../components/SimGuide'
import { Term } from '../components/Term'
import { Badge, Disclosure, PageHeader, primaryButton, secondaryButton } from '../components/ui'

const cardClass = 'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const thClass = 'py-2 pr-3 text-left text-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400'
const tdClass = 'py-1.5 pr-3 align-top whitespace-nowrap text-gray-700 dark:text-gray-300'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

const OOS_FRACTION = 0.3
const YEARS = 5

const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`)
const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2))
const signed = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
const paramText = (e: CompareEntry) => STRATEGY_TEMPLATES[e.template].params.map((p) => `${p.label} ${e.params[p.key] ?? p.default}`).join('、') || '—'
const sameEntries = (a: CompareEntry[], b: CompareEntry[]) => JSON.stringify(a) === JSON.stringify(b)

type Row = StrategyComparison['rows'][number]

interface Loaded {
  symbol: string
  start: string
  end: string
  data: Record<string, Bar[]>
  chips?: Record<string, ChipSeries>
}

// Strategy comparison (handbook 10 §6.5): every default template on one
// research card's stock in one click, an overall reading, and re-runs with
// adjusted conditions on the data already downloaded.
export function StrategyComparePage() {
  const [search] = useSearchParams()
  const theses = useAppStore((s) => s.stockTheses)
  const policy = useAppStore((s) => s.investmentPolicy)
  const comparisons = useAppStore((s) => s.strategyComparisons)
  const { library, save: saveLibrary } = useLibrary()
  const addStrategyComparison = useAppStore((s) => s.addStrategyComparison)
  const addTradingStrategy = useAppStore((s) => s.addTradingStrategy)
  const addBacktestRun = useAppStore((s) => s.addBacktestRun)

  const today = todayIsoDate()
  const linked = theses.find((t) => t.id === search.get('thesis'))
  const strategies = useAppStore((s) => s.tradingStrategies)
  // From a strategy card (範本庫「套用並比較」): its first symbol.
  const fromCard = strategies.find((s) => s.id === search.get('strategy'))
  const [codeText, setCodeText] = useState(linked?.ticker ?? (fromCard?.symbols[0] ?? parseSymbolList(search.get('symbol') ?? '')[0] ?? '').replace(/^TW:/, ''))
  const symbol = parseSymbolList(codeText)[0] ?? ''
  const code = symbol.replace(/^TW:/, '')
  const thesis = linked && linked.ticker === code ? linked : symbol ? thesisForCode('TW', code, theses) : null

  // The library's ticked templates (範本庫); changes here are for this run
  // until saved back.
  const defaults = compareEntriesOf(library, 1)
  const [entries, setEntries] = useState<CompareEntry[]>(defaults)
  const [off, setOff] = useState<string[]>([])
  const [start, setStart] = useState(isoDaysAgo(today, YEARS))
  const [end, setEnd] = useState(today)
  const [capital, setCapital] = useState(1_000_000)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'error'; message?: string }>({ kind: 'idle' })
  // Comparisons run on this visit, oldest first.
  const [runIds, setRunIds] = useState<string[]>([])
  const [cards, setCards] = useState<Record<string, string>>({})

  const forSymbol = comparisons.filter((c) => c.symbol === symbol)
  const current = runIds.length > 0 ? comparisons.find((c) => c.id === runIds.at(-1)) : forSymbol.at(-1)
  const previous = current ? forSymbol.filter((c) => c.createdAt < current.createdAt).at(-1) : undefined
  const active = entries.filter((e) => !off.includes(e.key))

  async function run() {
    if (!symbol.startsWith('TW:')) return setStatus({ kind: 'error', message: '請輸入台股或 ETF 代號' })
    if (start >= end) return setStatus({ kind: 'error', message: '開始日期須早於結束日期' })
    if (!active.some((e) => e.role === 'signal')) return setStatus({ kind: 'error', message: '至少要勾選一個訊號範本' })
    try {
      let source = loaded && loaded.symbol === symbol && loaded.start === start && loaded.end === end ? loaded : null
      if (!source) {
        setStatus({ kind: 'loading', message: '準備資料…' })
        const data = await loadPriceData([symbol], start, end, (p) =>
          setStatus({ kind: 'loading', message: `下載 ${formatSymbol(p.symbol)} ${p.done}/${p.total}（證交所限速，首次較久，之後使用快取）` }),
        )
        source = { symbol, start, end, data }
      }
      if (!source.chips && active.some((e) => STRATEGY_TEMPLATES[e.template].chipData)) {
        try {
          source = { ...source, chips: await loadChipData([symbol], start, () => setStatus({ kind: 'loading', message: `下載 ${code} 法人買賣超（FinMind）` })) }
        } catch {
          // The chip row shows why it did not run; the rest still do.
        }
      }
      setLoaded(source)
      setStatus({ kind: 'loading', message: '計算中…' })
      // Let the message paint before the synchronous runs.
      await new Promise((r) => setTimeout(r, 0))
      const result = runComparison({
        entries: active,
        base: { data: source.data, chips: source.chips, start, end, initialCapital: capital, costs: marketCosts(policy.brokerFeeDiscount), sizing: { mode: 'equal', riskPercent: policy.riskPerTradePercent } },
        oosFraction: OOS_FRACTION,
        maxDrawdownLimitPercent: policy.maxDrawdownTolerancePercent,
        priorTrials: priorTrialsFor(symbol, comparisons),
      })
      if (result.equity.length < 2) throw new Error('這段期間沒有足夠的價格資料')
      const isDefault = sameEntries(active, defaults)
      const id = addStrategyComparison({
        thesisId: thesis?.id,
        symbol,
        name: thesis?.name ?? '',
        start,
        end,
        initialCapital: capital,
        outOfSampleStart: result.oosStart,
        round: isDefault ? 0 : comparisons.filter((c) => runIds.includes(c.id) && c.round > 0).length + 1,
        trials: result.trials,
        summary: summarizeComparison(result.rows),
        ...toSavedRows(result),
      })
      setRunIds((ids) => [...ids, id])
      setCards({})
      setStatus({ kind: 'idle' })
    } catch (e) {
      setStatus({ kind: 'error', message: describeAiError(e) })
    }
  }

  // A chosen template becomes a strategy card in 開發中, with this run saved
  // as its first backtest so the usual path (paper trading, live gate) follows.
  function createCard(c: StrategyComparison, row: Row, index: number) {
    if (!row.stats) return
    const def = STRATEGY_TEMPLATES[row.entry.template]
    const benchIndex = c.rows.findIndex((r) => r.entry.template === 'buy_hold')
    const benchmark = benchIndex >= 0 ? c.rows[benchIndex].stats : null
    const id = addTradingStrategy({
      name: `${row.entry.label}・${code}`,
      template: row.entry.template,
      params: row.entry.params,
      symbols: [symbol],
      edge: '',
      entryRules: def.entry,
      exitRules: def.exit,
      riskPerTradePercent: policy.riskPerTradePercent,
      status: 'dev',
      notes: `由 ${c.createdAt.slice(0, 10)} 的策略比較建立：${row.verdictReason || c.summary.headline}`,
    })
    addBacktestRun({
      strategyId: id,
      label: `${row.entry.label}・${code}（策略比較）`,
      template: row.entry.template,
      params: row.entry.params,
      symbols: [symbol],
      start: c.start,
      end: c.end,
      initialCapital: c.initialCapital,
      outOfSampleStart: c.outOfSampleStart,
      dividendAdjusted: true,
      stats: row.stats,
      benchmark: benchmark ?? row.stats,
      equity: c.equity
        .filter((p) => p.values[index] !== null)
        .map((p) => ({ date: p.date, strategy: p.values[index] ?? 0, benchmark: benchIndex >= 0 ? (p.values[benchIndex] ?? 0) : 0 })),
    })
    setCards((m) => ({ ...m, [row.entry.key]: id }))
  }

  function setParam(key: string, param: string, value: number) {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, params: { ...e.params, [param]: value } } : e)))
  }

  function addEntry(template: StrategyTemplate) {
    const n = entries.filter((e) => e.template === template).length + 1
    const role = template === 'buy_hold' || template === 'dca' ? 'benchmark' : 'signal'
    setEntries((list) => [...list, { key: `${template}-${Date.now()}`, label: `${STRATEGY_TEMPLATES[template].label} ${n}`, template, params: defaultParams(template), role }])
  }

  const ordered = current
    ? [
        ...current.summary.ranking.map((k) => current.rows.findIndex((r) => r.entry.key === k)),
        ...current.rows.map((r, i) => (current.summary.ranking.includes(r.entry.key) ? -1 : i)),
      ].filter((i) => i >= 0)
    : []
  const before = (key: string) => previous?.rows.find((r) => r.entry.key === key)?.stats?.full
  const diff = (now: BacktestStats, then: BacktestStats | undefined) =>
    then && (Math.abs(now.cagr - then.cagr) >= 0.0005 || Math.abs(now.maxDrawdown - then.maxDrawdown) >= 0.0005) ? (
      <div className="text-[11px] text-gray-500 dark:text-gray-400">
        年化 {signed(now.cagr - then.cagr)}、回撤 {signed(now.maxDrawdown - then.maxDrawdown)}
      </div>
    ) : null

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PageHeader
        title="策略比較"
        summary={
          <>
            研究卡判定後，一鍵用全部預設範本回測同一檔股票 {YEARS} 年，用同一條過關規則（樣本外勝過買進持有，或以少賠勝出）比較，再看整體結論。說明見手冊{' '}
            <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              10 §6.5
            </Link>
            。
          </>
        }
        action={
          <button type="button" onClick={() => void run()} disabled={status.kind === 'loading'} className={primaryButton}>
            {current && runIds.length > 0 ? '用目前條件再跑' : '全部執行'}
          </button>
        }
      />

      <SimGuide />

      <div className={cardClass}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="台股或 ETF 代號">
            <input className={inputClass} value={codeText} onChange={(e) => setCodeText(e.target.value.toUpperCase())} placeholder="2330" />
          </Field>
          <Field label="開始">
            <input type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="結束">
            <input type="date" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="本金">
            <input type="number" className={inputClass} value={capital} min={10000} step={10000} onChange={(e) => setCapital(Number(e.target.value) || 0)} />
          </Field>
        </div>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          {thesis ? (
            <>
              研究卡：{thesis.ticker} {thesis.name}，結論 {thesis.verdict ? VERDICT_LABELS[thesis.verdict] : '尚未判定'}。
              {thesis.verdict === 'pass' && <span className="text-orange-700 dark:text-orange-400"> 結論為不投資，比較結果只供參考，不應建倉。</span>}
            </>
          ) : symbol ? (
            <>
              這檔還沒有研究卡；
              <Link to={`/research/stocks?new=${code}`} className={linkClass}>
                先建立研究卡
              </Link>
              ，判定後再比較較完整。
            </>
          ) : (
            '輸入代號，或從研究卡按「一鍵執行策略比較」。'
          )}{' '}
          手續費折扣 {policy.brokerFeeDiscount}（投資政策）、最後 {OOS_FRACTION * 100}% 期間為<Term name="樣本外" />。
        </p>
        {status.kind !== 'idle' && (
          <p className={`mt-2 text-sm ${status.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>{status.message}</p>
        )}

        <Disclosure summary={`調整條件（${active.length} 個範本${sameEntries(entries, defaults) && off.length === 0 ? '，範本庫' : '，已調整'}）`}>
          <div className="space-y-3">
            {entries.map((e) => (
              <div key={e.key} className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                    <input type="checkbox" checked={!off.includes(e.key)} onChange={() => setOff((o) => (o.includes(e.key) ? o.filter((k) => k !== e.key) : [...o, e.key]))} />
                    {e.label}
                  </label>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{e.role === 'benchmark' ? '基準' : STRATEGY_TEMPLATES[e.template].origin}</span>
                  {!library.some((t) => t.id === e.key) && (
                    <button type="button" className="text-xs text-gray-500 hover:underline dark:text-gray-400" onClick={() => setEntries((l) => l.filter((x) => x.key !== e.key))}>
                      移除
                    </button>
                  )}
                </div>
                {STRATEGY_TEMPLATES[e.template].params.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {STRATEGY_TEMPLATES[e.template].params.map((p) => (
                      <label key={p.key} className="text-xs text-gray-600 dark:text-gray-400" title={p.help.meaning}>
                        {p.label}
                        <input
                          type="number"
                          className={`${inputClass} mt-0.5 w-24`}
                          min={p.min}
                          max={p.max}
                          step={p.step}
                          value={e.params[p.key] ?? p.default}
                          onChange={(ev) => setParam(e.key, p.key, Number(ev.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${inputClass} w-auto`} value="" onChange={(e) => e.target.value && addEntry(e.target.value as StrategyTemplate)}>
                <option value="">＋ 加入範本…</option>
                {COMPARABLE_TEMPLATES.map((t) => (
                  <option key={t} value={t}>
                    {STRATEGY_TEMPLATES[t].label}
                  </option>
                ))}
              </select>
              <button type="button" className={secondaryButton} onClick={() => saveLibrary(withCompareSet(library, entries, off))}>
                存入範本庫
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  setEntries(defaults)
                  setOff([])
                }}
              >
                還原為範本庫
              </button>
              <Link to="/sim/strategies" className={linkClass}>
                到範本庫維護
              </Link>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              改完按上方「用目前條件再跑」，會沿用已下載的價格。每多試一組條件，<Term name="折減夏普比率" />就更嚴格：調整越多次，好看的結果越可能只是巧合。
            </p>
          </div>
        </Disclosure>
      </div>

      {current && (
        <>
          <div className={cardClass}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                整體分析：{formatSymbol(current.symbol)} {current.name}
              </h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {current.start} ～ {current.end}・{current.round === 0 ? '預設條件' : `調整第 ${current.round} 次`}・這檔累計試過 {current.trials} 個訊號範本
              </span>
            </div>
            <p className="mt-3 flex items-start gap-2 text-sm text-gray-900 dark:text-gray-100">
              <Badge tone={current.summary.kind === 'edge' ? 'good' : 'warn'}>{current.summary.kind === 'edge' ? '有優勢' : current.summary.kind === 'few_trades' ? '證據不足' : '沒有優勢'}</Badge>
              <span>{current.summary.headline}</span>
            </p>
            {current.summary.details.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
                {current.summary.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              下一步：挑一個範本「建立策略卡」，它會帶著這次的回測進入開發中；之後在回測頁做偏誤檢查、再到虛擬帳戶累積紀錄（手冊 10 §6、§7）。
            </p>
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">各範本結果</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              通過的排前面，再依樣本外<Term name="卡瑪比率" />排序；數字為全期間。{previous && `灰字為與上一次比較（${previous.createdAt.slice(0, 10)}）的差異。`}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className={thClass}>範本</th>
                    <th className={thClass}><Term name="年化報酬" /></th>
                    <th className={thClass}><Term name="最大回撤" /></th>
                    <th className={thClass}><Term name="夏普比率" /></th>
                    <th className={thClass}><Term name="卡瑪比率" /></th>
                    <th className={thClass}>交易</th>
                    <th className={thClass}><Term name="勝率" /></th>
                    <th className={thClass}><Term name="樣本外" /></th>
                    <th className={thClass} />
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((i) => {
                    const r = current.rows[i]
                    const s = r.stats?.full
                    return (
                      <tr key={r.entry.key} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                        <td className="w-64 min-w-56 py-1.5 pr-3 align-top text-gray-700 dark:text-gray-300">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {r.entry.label}
                            {r.entry.role === 'benchmark' && <span className="ml-1 text-xs font-normal text-gray-500">（基準）</span>}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{paramText(r.entry)}</div>
                          {r.warnings.length > 0 && <div className="mt-1 text-xs text-orange-700 dark:text-orange-400">{r.warnings.join('；')}</div>}
                        </td>
                        {s ? (
                          <>
                            <td className={tdClass}>
                              {pct(s.cagr)}
                              {r.entry.role === 'signal' && diff(s, before(r.entry.key))}
                            </td>
                            <td className={tdClass}>{pct(s.maxDrawdown)}</td>
                            <td className={tdClass}>{num(s.sharpe)}</td>
                            <td className={tdClass}>{num(calmarOf(s))}</td>
                            <td className={tdClass}>{s.trades}</td>
                            <td className={tdClass}>{s.winRate === null ? '—' : pct(s.winRate)}</td>
                            <td className={tdClass} title={r.verdictReason}>
                              {r.passed === null ? '—' : r.passed ? <Badge tone="good">通過</Badge> : <Badge tone="warn">未通過</Badge>}
                              {r.stats?.outOfSample && <div className="text-[11px] text-gray-500 dark:text-gray-400">年化 {pct(r.stats.outOfSample.cagr)}</div>}
                            </td>
                          </>
                        ) : (
                          <td colSpan={7} className={`${tdClass} text-xs text-gray-500 dark:text-gray-400`}>
                            {r.error ?? '—'}
                          </td>
                        )}
                        <td className={tdClass}>
                          {r.entry.role === 'signal' && r.stats && runIds.includes(current.id) ? (
                            cards[r.entry.key] ? (
                              <Link to={`/sim/backtest?strategy=${cards[r.entry.key]}`} className={linkClass}>
                                已建立，詳細回測 →
                              </Link>
                            ) : (
                              <button type="button" className={linkClass} onClick={() => createCard(current, r, i)}>
                                建立策略卡
                              </button>
                            )
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">權益曲線（起點 100）</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">虛線為基準；數字見上表。</p>
            <div className="mt-3">
              <CompareChart
                series={current.rows.map((r) => ({ key: r.entry.key, label: r.entry.label, benchmark: r.entry.role === 'benchmark' }))}
                points={current.equity}
                oosStart={current.outOfSampleStart}
              />
            </div>
          </div>
        </>
      )}

      {!symbol && comparisons.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">最近的比較</h2>
          <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {[...comparisons]
              .reverse()
              .filter((c, i, list) => list.findIndex((x) => x.symbol === c.symbol) === i)
              .slice(0, 10)
              .map((c) => (
                <li key={c.id}>
                  <button type="button" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400" onClick={() => setCodeText(c.symbol.replace(/^TW:/, ''))}>
                    {formatSymbol(c.symbol)} {c.name}
                  </button>
                  ：{c.createdAt.slice(0, 10)}・{c.summary.headline}
                </li>
              ))}
          </ul>
        </div>
      )}

      {forSymbol.length > 1 && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">這檔的比較紀錄</h2>
          <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {[...forSymbol].reverse().map((c) => (
              <li key={c.id}>
                {c.createdAt.slice(0, 10)}・{c.round === 0 ? '預設' : `調整 ${c.round}`}：{c.summary.headline}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
