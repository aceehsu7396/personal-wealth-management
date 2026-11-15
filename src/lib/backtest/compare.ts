import type { BacktestStats, CompareEntry, StrategyTemplate } from '../storage/schema'
import {
  benchmarkInput,
  costSensitivity,
  dailyReturnsOf,
  deflatedSharpe,
  runBacktest,
  sensitivityGrid,
  splitStats,
  weeklySample,
  type BacktestInput,
  type BacktestResult,
} from './engine'
import { INTERPRET_RULES, interpretBacktest, type Finding } from './interpret'
import { calmarOf, outOfSampleVerdict, type PassVerdict } from './passRule'
import { STARTER_STRATEGIES } from './starterStrategies'
import { STRATEGY_TEMPLATES, defaultParams } from './templates'

// Strategy comparison (handbook 10 §6.5): every default template on one
// stock over the same period, judged by the same out-of-sample pass rule
// against buy-and-hold, then read as a whole.

export type { CompareEntry }

const starterParams = (id: string) => STARTER_STRATEGIES.find((s) => s.id === id)?.card.params ?? {}

// Confirmed 2026-11-15: five signal templates and two benchmarks. Momentum
// rotation needs several stocks and free-text rules cannot be tested.
export const DEFAULT_COMPARE_SET: CompareEntry[] = [
  { key: 'ma_cross', label: '均線交叉', template: 'ma_cross', params: defaultParams('ma_cross'), role: 'signal' },
  { key: 'ma_200', label: '200 日線濾網', template: 'ma_cross', params: { ...defaultParams('ma_cross'), ...starterParams('tw50-200d-filter') }, role: 'signal' },
  { key: 'donchian', label: STRATEGY_TEMPLATES.donchian.label, template: 'donchian', params: defaultParams('donchian'), role: 'signal' },
  { key: 'rsi_reversion', label: STRATEGY_TEMPLATES.rsi_reversion.label, template: 'rsi_reversion', params: defaultParams('rsi_reversion'), role: 'signal' },
  { key: 'chip_flow', label: STRATEGY_TEMPLATES.chip_flow.label, template: 'chip_flow', params: defaultParams('chip_flow'), role: 'signal' },
  { key: 'buy_hold', label: STRATEGY_TEMPLATES.buy_hold.label, template: 'buy_hold', params: {}, role: 'benchmark' },
  { key: 'dca', label: STRATEGY_TEMPLATES.dca.label, template: 'dca', params: defaultParams('dca'), role: 'benchmark' },
]

// Templates that can join a comparison on one stock.
export const COMPARABLE_TEMPLATES = (Object.keys(STRATEGY_TEMPLATES) as StrategyTemplate[]).filter(
  (t) => STRATEGY_TEMPLATES[t].backtestable && !STRATEGY_TEMPLATES[t].multiSymbol,
)

export interface StatsTriple {
  full: BacktestStats
  inSample: BacktestStats | null
  outOfSample: BacktestStats | null
}

export interface CompareRow {
  entry: CompareEntry
  stats: StatsTriple | null
  // Signal rows only: the pass rule against buy-and-hold.
  verdict: PassVerdict | null
  findings: Finding[]
  costSensitive: boolean | null
  // Probability the Sharpe beats luck after this many tries.
  deflatedProbability: number | null
  avgR: number | null
  error?: string
}

export interface ComparisonResult {
  rows: CompareRow[]
  trials: number
  equity: { date: string; values: number[] }[]
  oosStart: string | null
}

export interface ComparisonInput {
  entries: CompareEntry[]
  base: Omit<BacktestInput, 'template' | 'params'>
  oosFraction: number
  maxDrawdownLimitPercent: number
  // Signal templates already tried on this stock in earlier comparisons.
  priorTrials?: number
}

const strip = (s: ReturnType<typeof splitStats>): StatsTriple => ({ full: s.full, inSample: s.inSample, outOfSample: s.outOfSample })

export function runComparison({ entries, base, oosFraction, maxDrawdownLimitPercent, priorTrials = 0 }: ComparisonInput): ComparisonResult {
  const signals = entries.filter((e) => e.role === 'signal')
  const trials = signals.length + priorTrials
  const bench = runBacktest(benchmarkInput({ ...base, template: 'buy_hold', params: {} }))
  const benchSplit = splitStats(bench, oosFraction)
  const curves: (BacktestResult | null)[] = []
  const rows = entries.map((entry): CompareRow => {
    const empty: CompareRow = { entry, stats: null, verdict: null, findings: [], costSensitive: null, deflatedProbability: null, avgR: null }
    if (STRATEGY_TEMPLATES[entry.template].chipData && !base.chips) {
      curves.push(null)
      return { ...empty, error: '沒有法人買賣超資料（FinMind 額度用完時稍後再試）' }
    }
    const input: BacktestInput = { ...base, template: entry.template, params: entry.params }
    const result = entry.template === 'buy_hold' ? bench : runBacktest(input)
    curves.push(result)
    const split = splitStats(result, oosFraction)
    const stats = strip(split)
    if (entry.role === 'benchmark') return { ...empty, stats }
    const rs = result.trades.map((t) => t.rMultiple).filter((r): r is number => r !== null)
    return {
      entry,
      stats,
      verdict: outOfSampleVerdict(stats.outOfSample, benchSplit.outOfSample),
      findings: interpretBacktest({
        full: stats.full,
        inSample: stats.inSample,
        outOfSample: stats.outOfSample,
        benchmarkFull: benchSplit.full,
        benchmarkOutOfSample: benchSplit.outOfSample,
        grid: sensitivityGrid(input, oosFraction),
        maxDrawdownLimitPercent,
      }),
      costSensitive: costSensitivity(input).sensitive,
      deflatedProbability: deflatedSharpe(dailyReturnsOf(result), trials)?.probability ?? null,
      avgR: rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    }
  })
  // Curves share the benchmark's dates; a missing row plots as nothing.
  const series = curves.map((c) => (c && c.index.length === bench.index.length ? c.index : bench.index.map(() => NaN)))
  const equity = weeklySample(bench.dates, ...series).map((p) => ({ date: p.date, values: p.values.map((v) => (Number.isFinite(v) ? v * 100 : NaN)) }))
  return { rows, trials, equity, oosStart: benchSplit.splitIndex !== null ? bench.dates[benchSplit.splitIndex] : null }
}

export type SummaryKind = 'edge' | 'few_trades' | 'none'

export interface ComparisonSummary {
  kind: SummaryKind
  headline: string
  details: string[]
  // Signal row keys, best first.
  ranking: string[]
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const oosOrFull = (s: StatsTriple) => s.outOfSample ?? s.full

// Passed first, then by out-of-sample Calmar ratio (losing less per unit
// of return is the goal of a trading sleeve, handbook 10 §6.2).
export function summarizeComparison(rows: CompareRow[]): ComparisonSummary {
  const signals = rows.filter((r): r is CompareRow & { stats: StatsTriple } => r.entry.role === 'signal' && r.stats !== null)
  const calmar = (r: (typeof signals)[number]) => calmarOf(oosOrFull(r.stats)) ?? -Infinity
  const ranked = [...signals].sort((a, b) => Number(b.verdict?.passed ?? false) - Number(a.verdict?.passed ?? false) || calmar(b) - calmar(a))
  const enough = (r: (typeof signals)[number]) => r.stats.full.trades >= INTERPRET_RULES.minTrades
  const passed = ranked.filter((r) => r.verdict?.passed)
  const reliable = passed.filter(enough)
  const details: string[] = []

  let kind: SummaryKind
  let headline: string
  if (reliable.length > 0) {
    kind = 'edge'
    const best = reliable[0]
    headline = `${reliable.map((r) => r.entry.label).join('、')}在樣本外通過過關規則；以「${best.entry.label}」最佳（${best.verdict?.route === 'risk' ? '以少賠通過' : '報酬勝過買進持有'}）。`
  } else if (passed.length > 0) {
    kind = 'few_trades'
    headline = `${passed.map((r) => r.entry.label).join('、')}通過，但交易少於 ${INTERPRET_RULES.minTrades} 筆，結論不可靠。`
  } else {
    kind = 'none'
    headline = '沒有範本在樣本外勝過買進持有：這檔較適合核心持有、定期定額，或不做交易部位。'
  }

  if (signals.length > 0) {
    const calm = [...signals].sort((a, b) => b.stats.full.maxDrawdown - a.stats.full.maxDrawdown)[0]
    details.push(`回撤最小：${calm.entry.label}（${pct(calm.stats.full.maxDrawdown)}）`)
  }
  const decay = signals
    .filter((r) => r.stats.inSample && r.stats.outOfSample && r.stats.inSample.cagr > 0)
    .map((r) => ({ r, gap: r.stats.inSample!.cagr - r.stats.outOfSample!.cagr }))
    .sort((a, b) => b.gap - a.gap)[0]
  if (decay && decay.gap > 0) details.push(`樣本內外落差最大：${decay.r.entry.label}（${pct(decay.r.stats.inSample!.cagr)} → ${pct(decay.r.stats.outOfSample!.cagr)}），可能過度擬合`)
  const costly = signals.filter((r) => r.costSensitive).map((r) => r.entry.label)
  if (costly.length > 0) details.push(`對交易成本敏感（成本加倍、年化少一半以上）：${costly.join('、')}`)
  const lucky = passed.filter((r) => r.deflatedProbability !== null && r.deflatedProbability < 0.95).map((r) => r.entry.label)
  if (lucky.length > 0) details.push(`考慮試過的次數後，可能是試出來的：${lucky.join('、')}`)
  const missing = rows.filter((r) => r.error).map((r) => `${r.entry.label}（${r.error}）`)
  if (missing.length > 0) details.push(`未執行：${missing.join('、')}`)

  return { kind, headline, details, ranking: ranked.map((r) => r.entry.key) }
}

// The stored form (schema StrategyComparison): findings become their
// titles and missing curve points become null, since NaN is not JSON.
export function toSavedRows(result: ComparisonResult) {
  return {
    rows: result.rows.map((r) => ({
      entry: r.entry,
      stats: r.stats,
      passed: r.verdict ? r.verdict.passed : null,
      verdictReason: r.verdict?.reason ?? '',
      warnings: r.findings.filter((f) => f.level !== 'ok').map((f) => f.title),
      costSensitive: r.costSensitive,
      deflatedProbability: r.deflatedProbability,
      avgR: r.avgR,
      ...(r.error ? { error: r.error } : {}),
    })),
    equity: result.equity.map((p) => ({ date: p.date, values: p.values.map((v) => (Number.isFinite(v) ? v : null)) })),
  }
}

// Signal templates tried on this symbol before, for the deflated Sharpe ratio.
export function priorTrialsFor(symbol: string, comparisons: { symbol: string; rows: { entry: { role: string }; stats: unknown }[] }[]): number {
  return comparisons.filter((c) => c.symbol === symbol).reduce((n, c) => n + c.rows.filter((r) => r.entry.role === 'signal' && r.stats).length, 0)
}
