import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import {
  BACKTEST_SETTING_HELP,
  STRATEGY_TEMPLATES,
  defaultParams,
  formatSymbol,
  parseSymbolList,
  resolveParams,
} from '../lib/backtest/templates'
import {
  benchmarkInput,
  coreTradingMix,
  marketCosts,
  parameterSweep,
  runBacktest,
  sensitivityGrid,
  splitStats,
  weeklySample,
  type BacktestInput,
  type BacktestResult,
  type MixRow,
  type ParameterSweep,
  type SensitivityGrid,
  type SizingMode,
  type StatsSplit,
} from '../lib/backtest/engine'
import { loadPriceData } from '../lib/backtest/data'
import { backtestPasses } from '../lib/calculations/strategyProgress'
import { outOfSampleVerdict } from '../lib/backtest/passRule'
import { importCsvSeries, isoDaysAgo, loadSeries } from '../lib/market/priceHistory'
import { todayIsoDate } from '../lib/market/twse'
import { describeAiError } from '../lib/ai/client'
import { DrawdownChart, EquityChart, SweepChart, type EquityPoint } from '../components/charts/BacktestCharts'
import { ParamHelp } from '../components/ParamHelp'
import { Field, inputClass, labelClass } from '../components/forms/FormField'
import type { BacktestStats, StrategyTemplate } from '../lib/storage/schema'
import { INTERPRET_RULES, interpretBacktest } from '../lib/backtest/interpret'
import { SimGuide } from '../components/SimGuide'
import { Term } from '../components/Term'

const cardClass =
  'mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800'
const thClass = 'py-2 pr-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400'
const tdClass = 'py-1.5 pr-3 text-gray-700 dark:text-gray-300'

function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
}

function num(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits)
}

interface RunOutput {
  input: BacktestInput
  strategy: BacktestResult
  benchmark: BacktestResult
  stats: StatsSplit
  benchStats: StatsSplit
  grid: SensitivityGrid | null
  points: EquityPoint[]
  oosStart: string | null
}

const STAT_ROWS: { label: string; get: (s: BacktestStats) => string }[] = [
  { label: '總報酬', get: (s) => pct(s.totalReturn) },
  { label: '年化報酬', get: (s) => pct(s.cagr) },
  { label: '最大回撤', get: (s) => pct(s.maxDrawdown) },
  { label: '夏普比率', get: (s) => num(s.sharpe) },
  { label: '交易次數', get: (s) => String(s.trades) },
  { label: '勝率', get: (s) => pct(s.winRate, 0) },
  { label: '獲利因子', get: (s) => num(s.profitFactor) },
  { label: '持倉時間', get: (s) => pct(s.exposure, 0) },
]

const FINDING_STYLE = {
  warning: 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-100',
  caution: 'border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200',
  ok: 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-100',
} as const
const FINDING_MARK = { warning: '⚠', caution: '△', ok: '✓' } as const

export function BacktestPage() {
  const [search] = useSearchParams()
  const strategies = useAppStore((s) => s.tradingStrategies)
  const runs = useAppStore((s) => s.backtestRuns)
  const policy = useAppStore((s) => s.investmentPolicy)
  const addBacktestRun = useAppStore((s) => s.addBacktestRun)
  const removeBacktestRun = useAppStore((s) => s.removeBacktestRun)
  const updateTradingStrategy = useAppStore((s) => s.updateTradingStrategy)
  const addTradingStrategy = useAppStore((s) => s.addTradingStrategy)

  const today = todayIsoDate()
  const testable = strategies.filter((s) => STRATEGY_TEMPLATES[s.template].backtestable)
  const initialCard = testable.find((s) => s.id === search.get('strategy'))
  // From the screener or watchlist: ?symbols=TW:2330,TW:2317&template=…
  const linkedSymbols = search.get('symbols')
  const linkedTemplate = search.get('template') as StrategyTemplate | null
  const startTemplate: StrategyTemplate =
    initialCard?.template ?? (linkedTemplate && STRATEGY_TEMPLATES[linkedTemplate]?.backtestable ? linkedTemplate : 'ma_cross')

  const [strategyId, setStrategyId] = useState(initialCard?.id ?? '')
  const [template, setTemplate] = useState<StrategyTemplate>(startTemplate)
  const [params, setParams] = useState<Record<string, number>>(
    initialCard ? resolveParams(initialCard.template, initialCard.params) : defaultParams(startTemplate),
  )
  const [symbolsText, setSymbolsText] = useState(
    initialCard?.symbols.join(', ') ??
      (linkedSymbols ? parseSymbolList(linkedSymbols).map((s) => (s.startsWith('TW:') ? s.slice(3) : s)).join(', ') : '0050'),
  )
  const [start, setStart] = useState(isoDaysAgo(today, 5))
  const [end, setEnd] = useState(today)
  const [capital, setCapital] = useState(1_000_000)
  const [discount, setDiscount] = useState(1)
  const [usFee, setUsFee] = useState(0)
  const [sizing, setSizing] = useState<SizingMode>('equal')
  // A strategy card's own risk, never above the policy cap.
  const riskOf = (s: { riskPerTradePercent: number } | undefined) => Math.min(s?.riskPerTradePercent ?? policy.riskPerTradePercent, policy.riskPerTradePercent)
  const [risk, setRisk] = useState(riskOf(initialCard))
  const [oos, setOos] = useState(30)
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'error'; message?: string }>({ kind: 'idle' })
  const [output, setOutput] = useState<RunOutput | null>(null)
  const [coreSymbol, setCoreSymbol] = useState('0050')
  const [mix, setMix] = useState<MixRow[] | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [csvVersion, setCsvVersion] = useState(0)
  const [sweepKey, setSweepKey] = useState('')
  const [sweep, setSweep] = useState<ParameterSweep | null>(null)

  const card = strategies.find((s) => s.id === strategyId)
  const def = STRATEGY_TEMPLATES[template]
  const symbols = parseSymbolList(symbolsText)
  const needsCsv = symbols.filter((s) => !s.startsWith('TW:'))
  const paramsChanged = card !== undefined && JSON.stringify(resolveParams(card.template, card.params)) !== JSON.stringify(params)

  function pickCard(id: string) {
    setStrategyId(id)
    const s = strategies.find((x) => x.id === id)
    if (!s) return
    setTemplate(s.template)
    setParams(resolveParams(s.template, s.params))
    setSymbolsText(s.symbols.join(', '))
    setRisk(riskOf(s))
  }

  function pickTemplate(t: StrategyTemplate) {
    setTemplate(t)
    setParams(defaultParams(t))
    setStrategyId('')
  }

  const progress = (p: { symbol: string; done: number; total: number }) =>
    setStatus({ kind: 'loading', message: `下載 ${formatSymbol(p.symbol)} ${p.done}/${p.total}（證交所限速，首次較久，之後使用快取）` })

  async function run() {
    if (symbols.length === 0) return setStatus({ kind: 'error', message: '請填寫標的' })
    if (def.multiSymbol && symbols.length < 2) return setStatus({ kind: 'error', message: '動能輪動至少需要 2 個標的' })
    if (start >= end) return setStatus({ kind: 'error', message: '開始日期須早於結束日期' })
    setStatus({ kind: 'loading', message: '準備資料…' })
    setMix(null)
    setSweep(null)
    setSavedId(null)
    try {
      const data = await loadPriceData(symbols, start, end, progress)
      setStatus({ kind: 'loading', message: '計算中…' })
      const input: BacktestInput = {
        template,
        params,
        data,
        start,
        end,
        initialCapital: capital,
        costs: marketCosts(discount, usFee),
        sizing: { mode: sizing, riskPercent: risk },
      }
      const strategy = runBacktest(input)
      if (strategy.dates.length < 2) throw new Error('這段期間沒有足夠的價格資料')
      const benchmark = runBacktest(benchmarkInput(input))
      const stats = splitStats(strategy, oos / 100)
      const benchStats = splitStats(benchmark, oos / 100)
      const points = weeklySample(strategy.dates, strategy.index, benchmark.index).map((p) => ({
        date: p.date,
        strategy: p.values[0] * 100,
        benchmark: p.values[1] * 100,
      }))
      setOutput({
        input,
        strategy,
        benchmark,
        stats,
        benchStats,
        grid: sensitivityGrid(input, oos / 100),
        points,
        oosStart: stats.splitIndex !== null ? strategy.dates[stats.splitIndex] : null,
      })
      setStatus({ kind: 'idle' })
    } catch (e) {
      setStatus({ kind: 'error', message: describeAiError(e) })
    }
  }

  // Runs on the data already loaded for the last backtest.
  function runSweep() {
    if (!output) return
    const key = sweepKey || STRATEGY_TEMPLATES[output.input.template].params[0]?.key
    if (!key) return
    setSweep(parameterSweep(output.input, key, oos / 100))
  }

  async function runMix() {
    if (!output) return
    const core = parseSymbolList(coreSymbol)[0]
    if (!core) return
    setStatus({ kind: 'loading', message: '準備核心資料…' })
    try {
      const data = await loadPriceData([core], output.input.start, output.input.end, progress)
      const coreRun = runBacktest({ ...benchmarkInput(output.input), data })
      setMix(coreTradingMix(output.strategy, coreRun))
      setStatus({ kind: 'idle' })
    } catch (e) {
      setStatus({ kind: 'error', message: describeAiError(e) })
    }
  }

  function save() {
    if (!output) return
    const { input, stats, benchStats } = output
    const strip = (s: StatsSplit) => ({ full: s.full, inSample: s.inSample, outOfSample: s.outOfSample })
    const id = addBacktestRun({
      strategyId: card?.id,
      label: card?.name ?? `${def.label}・${symbols.map(formatSymbol).join('、')}`,
      template,
      params,
      symbols,
      start: input.start,
      end: input.end,
      initialCapital: input.initialCapital,
      outOfSampleStart: output.oosStart,
      dividendAdjusted: true,
      stats: strip(stats),
      benchmark: strip(benchStats),
      equity: output.points.map((p) => ({ date: p.date, strategy: p.strategy, benchmark: p.benchmark })),
    })
    setSavedId(id)
  }

  function saveAsCard() {
    const id = addTradingStrategy({
      name: `${def.label}・${symbols.map(formatSymbol).join('、')}`,
      template,
      params,
      symbols,
      edge: '',
      entryRules: def.entry,
      exitRules: def.exit,
      riskPerTradePercent: risk,
      status: 'dev',
      notes: '',
    })
    setStrategyId(id)
  }

  function onCsv(symbol: string, file: File | undefined) {
    if (!file) return
    file
      .text()
      .then((text) => {
        importCsvSeries(symbol, text)
        setCsvVersion((v) => v + 1)
        setStatus({ kind: 'idle' })
      })
      .catch((e) => setStatus({ kind: 'error', message: describeAiError(e) }))
  }

  const verdict = output ? outOfSampleVerdict(output.stats.outOfSample, output.benchStats.outOfSample) : null
  const passed = verdict?.passed ?? false
  const fewSweepTrades = sweep !== null && sweep.points.every((p) => p.trades < INTERPRET_RULES.minTrades)
  const best = mix ? [...mix].sort((a, b) => (b.sharpe ?? -Infinity) - (a.sharpe ?? -Infinity))[0] : null

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">回測</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        用歷史日線檢驗策略：收盤判斷、隔日開盤成交，計入手續費與證交稅，台股自動還原除權息與分割。最後 {oos}% 期間保留為樣本外，
        樣本外<strong>年化報酬勝過買進持有</strong>，或<strong>夏普比率不低於買進持有、且最大回撤不到它的 2/3</strong>，才算通過（行動路線 4.2）。說明見手冊{' '}
        <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          10 §6
        </Link>
        。
      </p>

      <SimGuide />

      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">設定</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="策略卡">
            <select className={inputClass} value={strategyId} onChange={(e) => (e.target.value ? pickCard(e.target.value) : setStrategyId(''))}>
              <option value="">（不使用策略卡）</option>
              {testable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="策略範本">
            <select className={inputClass} value={template} onChange={(e) => pickTemplate(e.target.value as StrategyTemplate)}>
              {Object.entries(STRATEGY_TEMPLATES)
                .filter(([, t]) => t.backtestable)
                .map(([key, t]) => (
                  <option key={key} value={key}>
                    {t.label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="標的（逗號分隔；美股寫 US:代號）">
            <input className={inputClass} value={symbolsText} onChange={(e) => setSymbolsText(e.target.value)} />
          </Field>
          {def.params.map((p) => (
            <div key={p.key}>
              <Field label={p.label}>
                <input
                  type="number"
                  className={inputClass}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={params[p.key] ?? p.default}
                  onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })}
                />
              </Field>
              <ParamHelp help={p.help} range={{ min: p.min, max: p.max, default: p.default }} />
            </div>
          ))}
          <div>
            <Field label="開始日期">
              <input type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <ParamHelp help={BACKTEST_SETTING_HELP.period} />
          </div>
          <Field label="結束日期">
            <input type="date" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <div>
            <Field label={template === 'dca' ? '初始資金（定期定額不使用）' : '初始資金'}>
              <input type="number" step="10000" className={inputClass} value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
            </Field>
            <ParamHelp help={BACKTEST_SETTING_HELP.capital} />
          </div>
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
              <Field label={`每筆風險（%）${card ? '・帶入策略卡' : '・帶入投資政策'}`}>
                <input type="number" step="0.1" min="0.1" max="5" className={inputClass} value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
              </Field>
              {risk > policy.riskPerTradePercent && (
                <p className="mt-1 text-xs text-orange-700 dark:text-orange-400">高於投資政策上限 {policy.riskPerTradePercent}%，實單的交易前檢核不會通過。</p>
              )}
              <ParamHelp help={BACKTEST_SETTING_HELP.risk} />
            </div>
          )}
          <div>
            <Field label="樣本外比例（%）">
              <input type="number" step="5" min="0" max="50" className={inputClass} value={oos} onChange={(e) => setOos(Number(e.target.value))} />
            </Field>
            <ParamHelp help={BACKTEST_SETTING_HELP.oos} />
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{def.summary}</p>

        {needsCsv.length > 0 && (
          <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-900/40" key={csvVersion}>
            <p className={labelClass}>匯入價格（Yahoo Finance 的 Historical Data → Download，CSV 格式）</p>
            <ul className="mt-2 space-y-2">
              {needsCsv.map((s) => {
                const cached = loadSeries(s)
                return (
                  <li key={s} className="flex flex-wrap items-center gap-3">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{formatSymbol(s)}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {cached
                        ? `已匯入 ${cached.bars.length} 筆（${cached.bars[0].date}～${cached.bars[cached.bars.length - 1].date}）`
                        : '尚未匯入'}
                    </span>
                    <input type="file" accept=".csv,text/csv" className="text-xs" onChange={(e) => onCsv(s, e.target.files?.[0])} />
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={status.kind === 'loading'}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            執行回測
          </button>
          {status.kind === 'loading' && <span className="text-xs text-gray-500 dark:text-gray-400">{status.message}</span>}
          {status.kind === 'error' && <span className="text-sm text-red-600 dark:text-red-400">{status.message}</span>}
          {paramsChanged && (
            <button type="button" onClick={() => updateTradingStrategy(card.id, { params, symbols })} className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              把參數存回策略卡
            </button>
          )}
          {!card && (
            <button type="button" onClick={saveAsCard} className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              存成策略卡
            </button>
          )}
        </div>
      </div>

      {output && (
        <div className={cardClass}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">結果</h2>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                passed
                  ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300'
                  : 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200'
              }`}
            >
              {output.stats.outOfSample === null
                ? '未設定樣本外，無法判定'
                : verdict?.route === 'return'
                  ? '✓ 通過：樣本外報酬勝過買進持有'
                  : verdict?.route === 'risk'
                    ? '✓ 通過：樣本外風險調整後勝出'
                    : '✗ 未通過：報酬與風險調整後都沒有勝過買進持有'}
            </span>
          </div>
          {verdict && output.stats.outOfSample !== null && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{verdict.reason}</p>}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {output.strategy.dates[0]}～{output.strategy.dates[output.strategy.dates.length - 1]}，{output.strategy.dates.length} 個交易日
            {output.oosStart && `；樣本外自 ${output.oosStart} 起`}。價格已還原除權息。
          </p>

          <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">解讀</h3>
          <ul className="mt-2 space-y-2">
            {interpretBacktest({
              full: output.stats.full,
              inSample: output.stats.inSample,
              outOfSample: output.stats.outOfSample,
              benchmarkFull: output.benchStats.full,
              benchmarkOutOfSample: output.benchStats.outOfSample,
              grid: output.grid,
              maxDrawdownLimitPercent: policy.maxDrawdownTolerancePercent,
            }).map((f) => (
              <li key={f.title} className={`rounded-md border px-3 py-2 text-sm ${FINDING_STYLE[f.level]}`}>
                <p className="font-medium">
                  {FINDING_MARK[f.level]} {f.title}
                </p>
                <p className="mt-0.5 text-xs leading-5 opacity-90">{f.detail}</p>
              </li>
            ))}
          </ul>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className={thClass}>指標</th>
                  <th className={thClass}>策略・全期</th>
                  <th className={thClass}>
                    <Term name="樣本內">策略・樣本內</Term>
                  </th>
                  <th className={thClass}>
                    <Term name="樣本外">策略・樣本外</Term>
                  </th>
                  <th className={thClass}>買進持有・全期</th>
                  <th className={thClass}>買進持有・樣本外</th>
                </tr>
              </thead>
              <tbody>
                {STAT_ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                    <td className={`${tdClass} text-gray-500`}>
                      <Term name={row.label}>{row.label}</Term>
                    </td>
                    <td className={tdClass}>{row.get(output.stats.full)}</td>
                    <td className={tdClass}>{output.stats.inSample ? row.get(output.stats.inSample) : '—'}</td>
                    <td className={`${tdClass} font-medium`}>{output.stats.outOfSample ? row.get(output.stats.outOfSample) : '—'}</td>
                    <td className={tdClass}>{row.get(output.benchStats.full)}</td>
                    <td className={tdClass}>{output.benchStats.outOfSample ? row.get(output.benchStats.outOfSample) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">權益曲線（起始 = 100）</h3>
          <EquityChart data={output.points} oosStart={output.oosStart} />
          <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">回撤</h3>
          <DrawdownChart points={output.points} />

          {output.grid && (
            <>
              <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">參數敏感度（全期年化報酬／樣本外年化報酬）</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                主要參數上下調整 25%。數字應該平滑變化；只有中間那格好看，代表很可能是過度最佳化。
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th className={thClass}>
                        {output.grid.aLabel} ＼ {output.grid.bLabel}
                      </th>
                      {output.grid.bValues.map((b) => (
                        <th key={b} className={thClass}>
                          {b}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {output.grid.aValues.map((a) => (
                      <tr key={a}>
                        <td className={`${tdClass} text-gray-500`}>{a}</td>
                        {output.grid!.bValues.map((b) => {
                          const cell = output.grid!.cells.find((c) => c.a === a && c.b === b)!
                          const current = a === params[def.params[0].key] && b === params[def.params[1].key]
                          return (
                            <td key={b} className={`${tdClass} ${current ? 'font-semibold text-indigo-700 dark:text-indigo-400' : ''}`}>
                              {pct(cell.cagr)}／{pct(cell.oosCagr)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {STRATEGY_TEMPLATES[output.input.template].params.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-100">單一參數掃描</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                其他參數固定，把一個參數在允許範圍內取約 7 個值各回測一次。好的設定落在一片「高原」上，前後數值都不差；只有一個值特別好，多半是過度最佳化。
                選值時只看全期與樣本內，樣本外留作最後驗證（手冊{' '}
                <Link to="/handbook/10" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">10 §6.1</Link>）。
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <select
                  className={`${inputClass} w-auto`}
                  value={sweepKey || STRATEGY_TEMPLATES[output.input.template].params[0].key}
                  onChange={(e) => {
                    setSweepKey(e.target.value)
                    setSweep(null)
                  }}
                >
                  {STRATEGY_TEMPLATES[output.input.template].params.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={runSweep}
                  className="rounded-md border border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
                >
                  掃描
                </button>
              </div>
              {sweep && (
                <div className="mt-3">
                  <p
                    className={`rounded-md border p-2 text-sm ${sweep.isolatedPeak || fewSweepTrades ? FINDING_STYLE.warning : sweep.cagrSpread > 0.08 ? FINDING_STYLE.caution : FINDING_STYLE.ok}`}
                  >
                    {fewSweepTrades
                      ? `${FINDING_MARK.warning} 每個數值的交易次數都少於 ${INTERPRET_RULES.minTrades} 筆（最多 ${Math.max(...sweep.points.map((p) => p.trades))} 筆），差異多半是運氣，不能用來選參數。先延長回測期間（建議 5 年以上），再掃描。`
                      : sweep.isolatedPeak
                      ? `${FINDING_MARK.warning} 最佳值是孤立的高峰：前後數值都差 3 個百分點以上，換個期間很可能失效。改選高原中間的值。`
                      : sweep.cagrSpread > 0.08
                        ? `${FINDING_MARK.caution} 年化報酬在不同數值間相差 ${pct(sweep.cagrSpread)}，參數影響大；選結果相近的一段區間的中間值。`
                        : `${FINDING_MARK.ok} 各數值的年化報酬相差 ${pct(sweep.cagrSpread)}，結果平滑，這個參數不敏感，照原理選即可。`}
                  </p>
                  <SweepChart data={sweep.points} current={sweep.points.find((p) => p.current)?.value ?? sweep.points[0].value} label={sweep.label} />
                  <div className="overflow-x-auto">
                    <table className="mt-2 text-sm">
                      <thead>
                        <tr>
                          {[sweep.label, '全期年化', '最大回撤', '樣本外年化', '交易次數', ''].map((h) => (
                            <th key={h} className={thClass}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sweep.points.map((p) => (
                          <tr key={p.value} className={p.current ? 'font-semibold text-indigo-700 dark:text-indigo-400' : ''}>
                            <td className={tdClass}>{p.value}{p.current ? '（目前）' : ''}</td>
                            <td className={tdClass}>{pct(p.cagr)}</td>
                            <td className={tdClass}>{pct(p.maxDrawdown)}</td>
                            <td className={tdClass}>{pct(p.oosCagr)}</td>
                            <td className={tdClass}>{p.trades}</td>
                            <td className={tdClass}>
                              {!p.current && (
                                <button
                                  type="button"
                                  onClick={() => setParams({ ...params, [sweep.key]: p.value })}
                                  className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                                >
                                  套用
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">按「套用」只改上方設定，要再按「執行回測」才會重算；交易次數少於 20 筆的結果不具參考性。</p>
                </div>
              )}
            </>
          )}

          <details className="mt-6 text-sm">
            <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">
              交易明細（{output.strategy.trades.length} 筆）
            </summary>
            <div className="mt-2 max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {['標的', '進場', '進價', '出場', '出價', '報酬', 'R', '出場原因'].map((h) => (
                      <th key={h} className={thClass}>
                        {h === 'R' ? <Term name="R倍數">R</Term> : h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {output.strategy.trades.map((t, i) => (
                    <tr key={i} className="border-b border-gray-100 dark:border-gray-700">
                      <td className={tdClass}>{formatSymbol(t.symbol)}</td>
                      <td className={tdClass}>{t.entryDate}</td>
                      <td className={tdClass}>{num(t.entryPrice)}</td>
                      <td className={tdClass}>{t.exitDate}</td>
                      <td className={tdClass}>{num(t.exitPrice)}</td>
                      <td className={`${tdClass} ${t.pnl >= 0 ? 'text-indigo-700 dark:text-indigo-400' : 'text-orange-700 dark:text-orange-400'}`}>
                        {pct(t.returnPct)}
                      </td>
                      <td className={tdClass}>{num(t.rMultiple, 1)}</td>
                      <td className={tdClass}>{{ signal: '訊號', stop: '停損', rotation: '輪動', end: '期末' }[t.exitReason]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="mt-6 rounded-md bg-gray-50 p-4 dark:bg-gray-900/40">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">核心＋交易組合</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              把資金分成核心 ETF（買進持有）與這個策略，每年 1 月再平衡，比較不同比例的報酬與回撤，找出風險調整後最佳的配置。
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className={labelClass}>核心標的</span>
                <input className={inputClass} value={coreSymbol} onChange={(e) => setCoreSymbol(e.target.value)} />
              </label>
              <button
                type="button"
                onClick={() => void runMix()}
                disabled={status.kind === 'loading'}
                className="rounded-md border border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
              >
                計算組合
              </button>
            </div>
            {mix && (
              <table className="mt-3 text-sm">
                <thead>
                  <tr>
                    {['核心比例', '交易部位', '年化報酬', '最大回撤', '夏普比率'].map((h) => (
                      <th key={h} className={thClass}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mix.map((r) => {
                    const overLimit = -r.maxDrawdown * 100 > policy.maxDrawdownTolerancePercent
                    return (
                      <tr key={r.coreWeight} className={r === best ? 'font-semibold text-indigo-700 dark:text-indigo-400' : ''}>
                        <td className={tdClass}>{(r.coreWeight * 100).toFixed(0)}%</td>
                        <td className={tdClass}>{((1 - r.coreWeight) * 100).toFixed(0)}%</td>
                        <td className={tdClass}>{pct(r.cagr)}</td>
                        <td className={`${tdClass} ${overLimit ? 'text-orange-700 dark:text-orange-400' : ''}`}>{pct(r.maxDrawdown)}</td>
                        <td className={tdClass}>{num(r.sharpe)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {mix && best && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                粗體為夏普比率最高的組合（核心 {(best.coreWeight * 100).toFixed(0)}%）；橘色回撤超過投資政策上限 −{policy.maxDrawdownTolerancePercent}%。
                實際交易部位仍受學習階段上限約束。
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={savedId !== null}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {savedId ? '已儲存' : '儲存回測結果'}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {card ? `會連結到策略卡「${card.name}」` : '沒有連結策略卡：只計入行動路線 4.2，不能讓策略卡改為實單'}
            </span>
          </div>
        </div>
      )}

      {runs.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">已儲存的回測</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  {['名稱', '期間', '樣本外年化', '買進持有', '最大回撤', '結果', ''].map((h) => (
                    <th key={h} className={thClass}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...runs].reverse().map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                    <td className={tdClass}>{r.label}</td>
                    <td className={`${tdClass} text-xs`}>
                      {r.start}～{r.end}
                    </td>
                    <td className={tdClass}>{pct(r.stats.outOfSample?.cagr)}</td>
                    <td className={tdClass}>{pct(r.benchmark.outOfSample?.cagr)}</td>
                    <td className={tdClass}>{pct(r.stats.full.maxDrawdown)}</td>
                    <td className={tdClass}>{backtestPasses(r) ? '✓ 通過' : '✗'}</td>
                    <td className={tdClass}>
                      <button type="button" onClick={() => removeBacktestRun(r.id)} className="text-xs text-gray-500 hover:underline">
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
