import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import type { BacktestStats, Cadence, CompareEntry, StrategyComparison, StrategyTemplate } from '../lib/storage/schema'
import { DeepDive, type RunDraft } from '../components/backtest/DeepDive'
import { CsvImport } from '../components/backtest/CsvImport'
import { ParamHelp } from '../components/ParamHelp'
import {
  priorTrialsFor,
  runComparison,
  summarizeComparison,
  toSavedRows,
} from '../lib/backtest/compare'
import { marketCosts, type BacktestInput, type ChipSeries, type SizingMode } from '../lib/backtest/engine'
import { loadChipData, loadPriceData } from '../lib/backtest/data'
import { BACKTEST_SETTING_HELP, STRATEGY_TEMPLATES, defaultParams, formatSymbol, parseSymbolList, resolveParams } from '../lib/backtest/templates'
import { calmarOf } from '../lib/backtest/passRule'
import { compareEntriesOf, useLibrary, withCompareSet } from '../lib/backtest/library'
import { findDuplicate } from '../lib/backtest/cardGroups'
import { cardDraftOf, entryLabel, runDraftOf } from '../lib/backtest/comparisonCard'
import { DEFAULT_DECISION_DAY, WEEKDAY_LABELS } from '../lib/backtest/weekly'
import { RunRecords } from '../components/backtest/RunRecords'
import { FewTradesPanel } from '../components/backtest/FewTradesPanel'
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

const YEARS = 5

const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`)
const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2))
const signed = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
// Calendar days held, in weeks once past two.
const holdText = (days: number) => (days >= 14 ? `${(days / 7).toFixed(1)} 週` : `${Math.round(days)} 天`)
const paramText = (e: CompareEntry) => STRATEGY_TEMPLATES[e.template].params.map((p) => `${p.label} ${e.params[p.key] ?? p.default}`).join('、') || '—'
const sameEntries = (a: CompareEntry[], b: CompareEntry[]) => JSON.stringify(a) === JSON.stringify(b)
// A comparison's symbols are saved joined: "TW:0050,TW:2330".
const symbolLabel = (key: string) => key.split(',').map(formatSymbol).join('、')
const BACKTESTABLE = (Object.keys(STRATEGY_TEMPLATES) as StrategyTemplate[]).filter((t) => STRATEGY_TEMPLATES[t].backtestable)

type Row = StrategyComparison['rows'][number]

interface Loaded {
  symbol: string
  start: string
  end: string
  data: Record<string, Bar[]>
  chips?: Record<string, ChipSeries>
}

// Comparison and backtest (handbook 10 §6, §6.5): the library's templates
// (or one strategy card) on one or more symbols in one click, an overall
// reading, re-runs with adjusted conditions on the data already downloaded,
// and a deep dive into any one template.
export function StrategyComparePage() {
  // A new address (a stock picked from 最近的比較, or the browser's back
  // button) starts the page over from its parameters.
  const { search } = useLocation()
  return <ComparePage key={search} />
}

function ComparePage() {
  const [search] = useSearchParams()
  const navigate = useNavigate()
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
  const weeklyDecisionDay = useAppStore((s) => s.tradingPrefs?.weeklyDecisionDay ?? DEFAULT_DECISION_DAY)
  // From a strategy card (範本庫「套用並比較」、策略卡「下一步」): its own
  // rules on its symbols, against the benchmarks.
  const fromCard = strategies.find((s) => s.id === search.get('strategy') && STRATEGY_TEMPLATES[s.template].backtestable)
  const cardKey = fromCard ? `card:${fromCard.id}` : ''
  const [codeText, setCodeText] = useState(() =>
    (linked ? [linked.ticker] : fromCard ? fromCard.symbols : parseSymbolList(search.get('symbols') ?? search.get('symbol') ?? '')).map((x) => x.replace(/^TW:/, '')).join(', '),
  )
  const symbols = parseSymbolList(codeText)
  const symbol = symbols.join(',')
  const code = symbols.length === 1 ? symbols[0].replace(/^TW:/, '') : ''
  const thesis = code && symbols[0].startsWith('TW:') ? (linked && linked.ticker === code ? linked : thesisForCode('TW', code, theses)) : null

  // The library's ticked templates (範本庫); changes here are for this run
  // until saved back. Rotation runs only on two or more symbols.
  const defaults = compareEntriesOf(library, 2)
  const [entries, setEntries] = useState<CompareEntry[]>(() => {
    let list = fromCard
      ? [{ key: cardKey, label: `策略卡：${fromCard.name}`, template: fromCard.template, params: resolveParams(fromCard.template, fromCard.params), role: 'signal' as const, cadence: fromCard.cadence ?? 'daily' }, ...defaults]
      : defaults
    // From the screener: ?template=momentum_rotation adds it when missing.
    const linkedTemplate = search.get('template') as StrategyTemplate | null
    if (linkedTemplate && STRATEGY_TEMPLATES[linkedTemplate]?.backtestable && !list.some((e) => e.template === linkedTemplate))
      list = [...list, { key: `${linkedTemplate}-link`, label: STRATEGY_TEMPLATES[linkedTemplate].label, template: linkedTemplate, params: defaultParams(linkedTemplate), role: 'signal' }]
    return list
  })
  // A card's own run starts without the library's signal templates.
  const [off, setOff] = useState<string[]>(() => (fromCard ? defaults.filter((e) => e.role === 'signal').map((e) => e.key) : []))
  const [discount, setDiscount] = useState(policy.brokerFeeDiscount)
  const [usFee, setUsFee] = useState(0)
  const [sizing, setSizing] = useState<SizingMode>('equal')
  const [risk, setRisk] = useState(Math.min(fromCard?.riskPerTradePercent ?? policy.riskPerTradePercent, policy.riskPerTradePercent))
  const [oos, setOos] = useState(30)
  // The daily templates' cadence for this run; the weekly templates and a
  // card's own row keep theirs.
  const [cadence, setCadence] = useState<Cadence>(search.get('cadence') === 'weekly' ? 'weekly' : 'daily')
  const [decisionDay, setDecisionDay] = useState(fromCard?.decisionDay ?? weeklyDecisionDay)
  const [dive, setDive] = useState<string | null>(null)
  const [savedDives, setSavedDives] = useState<string[]>([])
  const [startDate, setStart] = useState(isoDaysAgo(today, YEARS))
  const start = startDate
  const [end, setEnd] = useState(today)
  const [capital, setCapital] = useState(1_000_000)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'error' | 'info'; message?: string }>({ kind: 'idle' })
  // Comparisons run on this visit, oldest first.
  const [runIds, setRunIds] = useState<string[]>([])
  const [cards, setCards] = useState<Record<string, string>>({})
  // Rows whose card already existed: key → that card's name.
  const [reused, setReused] = useState<Record<string, string>>({})

  const forSymbol = comparisons.filter((c) => c.symbol === symbol)
  const current = runIds.length > 0 ? comparisons.find((c) => c.id === runIds.at(-1)) : forSymbol.at(-1)
  const previous = current ? forSymbol.filter((c) => c.createdAt < current.createdAt).at(-1) : undefined
  // Cards made here belong to the comparison on screen.
  const currentId = current?.id
  useEffect(() => {
    setCards({})
    setReused({})
  }, [currentId])
  const runnable = (e: CompareEntry) => !STRATEGY_TEMPLATES[e.template].multiSymbol || symbols.length >= 2
  const active = entries.filter((e) => !off.includes(e.key) && runnable(e))

  // Prices (and flows when a template needs them), reusing what this
  // visit already loaded.
  async function ensureData(key: string, from: string, to: string, needChips: boolean): Promise<Loaded> {
    const list = key.split(',')
    let source = loaded && loaded.symbol === key && loaded.start === from && loaded.end === to ? loaded : null
    if (!source) {
      setStatus({ kind: 'loading', message: '準備資料…' })
      const data = await loadPriceData(list, from, to, (p) =>
        setStatus({ kind: 'loading', message: `下載 ${formatSymbol(p.symbol)} ${p.done}/${p.total}（證交所限速，首次較久，之後使用快取）` }),
      )
      source = { symbol: key, start: from, end: to, data }
    }
    if (!source.chips && needChips && list.every((x) => x.startsWith('TW:'))) {
      try {
        source = { ...source, chips: await loadChipData(list, from, (p) => setStatus({ kind: 'loading', message: `下載 ${formatSymbol(p.symbol)} 法人買賣超（FinMind）` })) }
      } catch {
        // The chip row shows why it did not run; the rest still do.
      }
    }
    setLoaded(source)
    return source
  }

  // A basket or a longer period from the few-trades panel runs at once,
  // with the inputs updated to match.
  async function run(over: { codes?: string[]; start?: string } = {}) {
    const symbols = over.codes ?? parseSymbolList(codeText)
    const symbol = symbols.join(',')
    const start = over.start ?? startDate
    if (over.codes) setCodeText(symbols.map((x) => x.replace(/^TW:/, '')).join(', '))
    if (over.start) setStart(over.start)
    const canRun = (e: CompareEntry) => !STRATEGY_TEMPLATES[e.template].multiSymbol || symbols.length >= 2
    const active = entries.filter((e) => !off.includes(e.key) && canRun(e))
    const runThesis = symbols.length === 1 ? thesis : null
    if (symbols.length === 0) return setStatus({ kind: 'error', message: '請輸入代號' })
    if (start >= end) return setStatus({ kind: 'error', message: '開始日期須早於結束日期' })
    if (!active.some((e) => e.role === 'signal')) return setStatus({ kind: 'error', message: '至少要勾選一個訊號範本' })
    try {
      const source = await ensureData(symbol, start, end, active.some((e) => STRATEGY_TEMPLATES[e.template].chipData))
      setStatus({ kind: 'loading', message: '計算中…' })
      // Let the message paint before the synchronous runs.
      await new Promise((r) => setTimeout(r, 0))
      const result = runComparison({
        entries: active,
        base: { data: source.data, chips: source.chips, start, end, initialCapital: capital, costs: marketCosts(discount, usFee), sizing: { mode: sizing, riskPercent: risk }, cadence, decisionDay },
        oosFraction: oos / 100,
        maxDrawdownLimitPercent: policy.maxDrawdownTolerancePercent,
        priorTrials: priorTrialsFor(symbol, comparisons),
      })
      if (result.equity.length < 2) throw new Error('這段期間沒有足夠的價格資料')
      const isDefault = sameEntries(active, defaults.filter(canRun))
      const id = addStrategyComparison({
        thesisId: runThesis?.id,
        symbol,
        name: runThesis?.name ?? (fromCard && active.some((e) => e.key === cardKey) ? fromCard.name : ''),
        start,
        end,
        initialCapital: capital,
        outOfSampleStart: result.oosStart,
        round: isDefault ? 0 : comparisons.filter((c) => runIds.includes(c.id) && c.round > 0).length + 1,
        trials: result.trials,
        summary: summarizeComparison(result.rows),
        ...(result.rows.some((r) => r.entry.cadence === 'weekly') ? { decisionDay } : {}),
        ...toSavedRows(result),
      })
      setRunIds((ids) => [...ids, id])
      setCards({})
      setDive(null)
      setStatus({ kind: 'idle' })
    } catch (e) {
      setStatus({ kind: 'error', message: describeAiError(e) })
    }
  }

  // A chosen template becomes a strategy card in 開發中, with this run saved
  // as its first backtest so the usual path (paper trading, live gate) follows.
  function createCard(c: StrategyComparison, row: Row) {
    if (!row.stats) return
    const draft = cardDraftOf(c, row, library, policy.riskPerTradePercent)
    // The same template, parameters and symbols already have a card: the
    // run goes there instead of a second card.
    const same = findDuplicate(strategies, draft)
    const id = same?.id ?? addTradingStrategy(draft)
    if (same) setReused((m) => ({ ...m, [row.entry.key]: same.name }))
    const run = runDraftOf(c, row, id)
    if (run) addBacktestRun(run)
    setCards((m) => ({ ...m, [row.entry.key]: id }))
    return id
  }

  // The deep dive's own run saved to the row's card: the card this page
  // was opened from, one made here, or a new one.
  function saveDive(c: StrategyComparison, row: Row, run: RunDraft) {
    let id = row.entry.key === cardKey && fromCard ? fromCard.id : cards[row.entry.key]
    if (!id) {
      const made = createCard(c, row)
      if (!made) return
      id = made
    }
    const name = strategies.find((x) => x.id === id)?.name ?? row.entry.label
    const weekly = row.entry.cadence === 'weekly' ? { cadence: 'weekly' as const, decisionDay: c.decisionDay ?? DEFAULT_DECISION_DAY } : {}
    addBacktestRun({ ...run, ...weekly, strategyId: id, label: `${name}（深入檢驗）` })
    setSavedDives((l) => [...l, `${c.id}:${row.entry.key}`])
  }

  async function openDive(key: string) {
    if (dive === key || !current) return setDive(null)
    setDive(key)
    const row = current.rows.find((r) => r.entry.key === key)
    try {
      await ensureData(current.symbol, current.start, current.end, row ? !!STRATEGY_TEMPLATES[row.entry.template].chipData : false)
      setStatus({ kind: 'idle' })
    } catch (e) {
      setStatus({ kind: 'error', message: describeAiError(e) })
    }
  }

  function setParam(key: string, param: string, value: number) {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, params: { ...e.params, [param]: value } } : e)))
  }

  const diveRow = current && dive ? current.rows.find((r) => r.entry.key === dive) : undefined
  const diveInput = useMemo<BacktestInput | null>(
    () =>
      current && diveRow && loaded && loaded.symbol === current.symbol && loaded.start === current.start && loaded.end === current.end
        ? {
            template: diveRow.entry.template,
            params: diveRow.entry.params,
            data: loaded.data,
            chips: loaded.chips,
            start: current.start,
            end: current.end,
            initialCapital: current.initialCapital,
            costs: marketCosts(discount, usFee),
            sizing: { mode: sizing, riskPercent: risk },
            cadence: diveRow.entry.cadence,
            decisionDay: current.decisionDay,
          }
        : null,
    [current, diveRow, loaded, discount, usFee, sizing, risk],
  )
  const diveCardId = diveRow ? (diveRow.entry.key === cardKey ? fromCard?.id : cards[diveRow.entry.key]) : undefined
  const diveCard = strategies.find((x) => x.id === diveCardId)

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
        title="比較與回測"
        summary={
          <>
            一鍵用範本庫勾選的範本（或一張策略卡）回測同一組標的 {YEARS} 年：收盤判斷、隔日開盤成交，計入手續費與證交稅，台股自動還原除權息。用同一條過關規則（樣本外勝過買進持有，或以少賠勝出）比較，再對想用的範本按「深入檢驗」。說明見手冊{' '}
            <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              10 §6、§6.5
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
          <Field label="代號（可多檔，逗號分隔；美股寫 US:代號）">
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
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div className="w-56">
            <Field label="判斷頻率（日線範本）">
              <select className={inputClass} value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                <option value="daily">每日收盤判斷</option>
                <option value="weekly">每週判斷一次</option>
              </select>
            </Field>
          </div>
          <div className="w-40">
            <Field label="每週判斷日">
              <select className={inputClass} value={decisionDay} onChange={(e) => setDecisionDay(Number(e.target.value))}>
                {Object.entries(WEEKDAY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}收盤
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="max-w-md pb-1 text-xs text-gray-500 dark:text-gray-400">
            週線範本（週線趨勢、週線突破、週線拉回、每週動能輪動）一律每週判斷；選「每週」時，日線範本也改成只在判斷日收盤決定進出場、下個交易日開盤成交，停損每天照常。
          </p>
        </div>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          {thesis ? (
            <>
              研究卡：{thesis.ticker} {thesis.name}，結論 {thesis.verdict ? VERDICT_LABELS[thesis.verdict] : '尚未判定'}。
              {thesis.verdict === 'pass' && <span className="text-orange-700 dark:text-orange-400"> 結論為不投資，比較結果只供參考，不應建倉。</span>}
            </>
          ) : fromCard ? (
            <>策略卡「{fromCard.name}」：按「全部執行」，再對「策略卡」那一列按「深入檢驗」並存成這張卡的回測。要和範本庫一起比，在「調整條件」勾選範本。</>
          ) : symbols.length > 1 ? (
            <>多檔時每個範本都以等權組合回測，動能輪動在這些標的之間輪動。</>
          ) : code ? (
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
          手續費折扣 {discount}、{sizing === 'risk' ? `風險部位法每筆 ${risk}%` : '每個標的等額'}、最後 {oos}% 期間為<Term name="樣本外" />（進階設定）。
        </p>
        <CsvImport symbols={symbols} onError={(message) => setStatus({ kind: 'error', message })} />

        <Disclosure summary="進階設定（手續費、部位、樣本外）">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Field label="台股手續費折扣（1 = 無折扣，0.6 = 六折）">
                <input type="number" step="0.05" min="0" max="1" className={inputClass} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
              </Field>
              <ParamHelp help={BACKTEST_SETTING_HELP.fees} />
            </div>
            <Field label="美股手續費（%）">
              <input type="number" step="0.01" min="0" className={inputClass} value={usFee} onChange={(e) => setUsFee(Number(e.target.value))} />
            </Field>
            <div>
              <Field label="樣本外比例（%）">
                <input type="number" step="5" min="0" max="50" className={inputClass} value={oos} onChange={(e) => setOos(Number(e.target.value))} />
              </Field>
              <ParamHelp help={BACKTEST_SETTING_HELP.oos} />
            </div>
            <div>
              <Field label="部位大小">
                <select className={inputClass} value={sizing} onChange={(e) => setSizing(e.target.value as SizingMode)}>
                  <option value="equal">每個標的等額（全額投入）</option>
                  <option value="risk">風險部位法（依 ATR 停損）</option>
                </select>
              </Field>
              <ParamHelp help={BACKTEST_SETTING_HELP.sizing} />
            </div>
            {sizing === 'risk' && (
              <div>
                <Field label={`每筆風險（%）${fromCard ? '・帶入策略卡' : '・帶入投資政策'}`}>
                  <input type="number" step="0.1" min="0.1" max="5" className={inputClass} value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
                </Field>
                {risk > policy.riskPerTradePercent && <p className="mt-1 text-xs text-orange-700 dark:text-orange-400">高於投資政策上限 {policy.riskPerTradePercent}%，實單的交易前檢核不會通過。</p>}
                <ParamHelp help={BACKTEST_SETTING_HELP.risk} />
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">改完按「用目前條件再跑」；價格沿用已下載的資料。</p>
        </Disclosure>
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
                  {!runnable(e) && <span className="text-xs text-gray-500 dark:text-gray-400">需 2 檔以上</span>}
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
                {BACKTESTABLE.map((t) => (
                  <option key={t} value={t}>
                    {STRATEGY_TEMPLATES[t].label}
                  </option>
                ))}
              </select>
              <button type="button" className={secondaryButton} onClick={() => saveLibrary(withCompareSet(library, entries.filter((e) => e.key !== cardKey), off))}>
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
          {comparisons.length > 0 && (
            <button
              type="button"
              className="mt-6 text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-400"
              onClick={() => {
                setCodeText('')
                if (search.toString()) navigate('/sim/compare')
              }}
            >
              ← 回到最近的比較
            </button>
          )}
          <div className={cardClass}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                整體分析：{symbolLabel(current.symbol)} {current.name}
              </h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {current.start} ～ {current.end}・{current.auto ? `每日自動研究（${current.auto.screen}）` : current.round === 0 ? '預設條件' : `調整第 ${current.round} 次`}・這檔累計試過 {current.trials} 個訊號範本
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
            <FewTradesPanel comparison={current} today={today} busy={status.kind === 'loading'} onRun={(over) => void run(over)} />
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              下一步：對想用的範本按「深入檢驗」，看解讀、參數敏感度與偏誤檢查，再「建立策略卡」（會帶著這次的回測進入開發中），之後到虛擬帳戶累積紀錄（手冊 10 §6、§7）。
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
                            {entryLabel(r.entry)}
                            {r.entry.role === 'benchmark' && !r.entry.label.includes('基準') && <span className="ml-1 text-xs font-normal text-gray-500">（基準）</span>}
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
                            <td className={tdClass}>
                              {r.perSymbol ? `合計 ${s.trades}` : s.trades}
                              {r.perSymbol && (
                                <div className="text-[11px] text-gray-500 dark:text-gray-400" title={r.perSymbol.map((x) => `${formatSymbol(x.symbol)}：${x.trades} 筆，${x.passed ? '通過' : '未通過'}`).join('\n')}>
                                  各檔 {r.perSymbol.filter((x) => x.passed).length}/{r.perSymbol.length} 通過
                                </div>
                              )}
                              {r.avgHoldDays != null && <div className="text-[11px] text-gray-500 dark:text-gray-400">平均持有 {holdText(r.avgHoldDays)}</div>}
                            </td>
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
                          {r.entry.role === 'signal' && r.stats && (
                            <div className="flex flex-col items-start gap-1">
                              <button type="button" className={linkClass} aria-expanded={dive === r.entry.key} onClick={() => void openDive(r.entry.key)}>
                                {dive === r.entry.key ? '收合檢驗' : '深入檢驗'}
                              </button>
                              {r.entry.key !== cardKey &&
                                (() => {
                                  if (cards[r.entry.key])
                                    return (
                                      <Link to={`/sim/strategies?card=${cards[r.entry.key]}`} className={`${linkClass} whitespace-normal`}>
                                        {reused[r.entry.key] ? `已有相同策略卡「${reused[r.entry.key]}」，回測已存入` : '已建立策略卡'}
                                      </Link>
                                    )
                                  // A card made earlier (by hand or by the daily research).
                                  const existing = findDuplicate(strategies, cardDraftOf(current, r, library, policy.riskPerTradePercent))
                                  return existing ? (
                                    <Link to={`/sim/strategies?card=${existing.id}`} className={`${linkClass} whitespace-normal`}>
                                      已有策略卡「{existing.name}」
                                    </Link>
                                  ) : (
                                    <button type="button" className={linkClass} onClick={() => createCard(current, r)}>
                                      建立策略卡
                                    </button>
                                  )
                                })()}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {diveRow &&
              (diveInput ? (
                <DeepDive
                  key={`${current.id}:${diveRow.entry.key}`}
                  label={entryLabel(diveRow.entry)}
                  input={diveInput}
                  oosFraction={oos / 100}
                  policy={policy}
                  priorTrials={priorTrialsFor(current.symbol, comparisons)}
                  card={diveCard}
                  saved={savedDives.includes(`${current.id}:${diveRow.entry.key}`)}
                  saveLabel={diveRow.entry.key === cardKey ? '存為這張策略卡的回測' : cards[diveRow.entry.key] ? '存入剛建立的策略卡' : '建立策略卡並儲存回測'}
                  onSave={(draft) => saveDive(current, diveRow, draft)}
                  onApplyParam={(key, value) => {
                    setParam(diveRow.entry.key, key, value)
                    setStatus({ kind: 'info', message: `已把「${diveRow.entry.label}」的參數改為 ${value}，按「用目前條件再跑」重算。` })
                  }}
                />
              ) : (
                <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">{status.kind === 'loading' ? status.message : '讀取價格資料中…'}</p>
              ))}
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">權益曲線（起點 100）</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">虛線為基準；數字見上表。</p>
            {current.equity.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">自動回測未保存走勢圖；按上方「全部執行」可以重跑並看到走勢圖，也才能建立策略卡。</p>
            ) : (
              <div className="mt-3">
                <CompareChart
                  series={current.rows.map((r) => ({ key: r.entry.key, label: entryLabel(r.entry), benchmark: r.entry.role === 'benchmark' }))}
                  points={current.equity}
                  oosStart={current.outOfSampleStart}
                />
              </div>
            )}
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
                  <Link to={`/sim/compare?symbols=${c.symbol}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
                    {symbolLabel(c.symbol)} {c.name}
                  </Link>
                  ：{c.createdAt.slice(0, 10)}
                  {c.auto && `（每日自動研究・${c.auto.screen}）`}・{c.summary.headline}
                </li>
              ))}
          </ul>
        </div>
      )}

      {forSymbol.length > 1 && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">這組標的的比較紀錄</h2>
          <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {[...forSymbol].reverse().map((c) => (
              <li key={c.id}>
                {c.createdAt.slice(0, 10)}・{c.auto ? '每日自動研究' : c.round === 0 ? '預設' : `調整 ${c.round}`}：{c.summary.headline}
              </li>
            ))}
          </ul>
        </div>
      )}

      <RunRecords symbols={symbols} />
    </div>
  )
}
