import type { BacktestRun, CompareEntry, LibraryTemplate, StrategyComparison, TradingStrategy } from '../storage/schema'
import { INTERPRET_RULES } from './interpret'
import { STRATEGY_TEMPLATES } from './templates'
import { DEFAULT_DECISION_DAY, isWeeklyTemplate } from './weekly'

// A template in a saved comparison turned into a strategy card (開發中)
// with the comparison as its first backtest; by hand on the comparison
// page, or automatically for the daily research's reliable passes.

type Row = StrategyComparison['rows'][number]
export type CardDraft = Omit<TradingStrategy, 'id' | 'createdAt' | 'updatedAt'>
export type RunDraft = Omit<BacktestRun, 'id' | 'createdAt'>

// Weekly rows say so in their name.
export const entryLabel = (e: CompareEntry) => (e.cadence === 'weekly' && !isWeeklyTemplate(e.template) ? `${e.label}（週）` : e.label)

const codesOf = (c: StrategyComparison) => c.symbol.split(',').map((x) => x.replace(/^TW:/, '')).join('、')

export function cardDraftOf(c: StrategyComparison, row: Row, library: LibraryTemplate[], riskPercent: number, notes?: string): CardDraft {
  const def = STRATEGY_TEMPLATES[row.entry.template]
  const t = library.find((x) => x.id === row.entry.key)
  const weekly = row.entry.cadence === 'weekly'
  return {
    name: `${entryLabel(row.entry)}・${codesOf(c)}`,
    template: row.entry.template,
    params: row.entry.params,
    symbols: c.symbol.split(','),
    edge: t?.edge ?? '',
    entryRules: t?.entryRules || def.entry,
    exitRules: t?.exitRules || def.exit,
    riskPerTradePercent: riskPercent,
    status: 'dev',
    notes: notes ?? `由 ${c.createdAt.slice(0, 10)} 的策略比較建立：${row.verdictReason || c.summary.headline}`,
    ...(weekly ? { cadence: 'weekly' as const, ...(c.decisionDay ? { decisionDay: c.decisionDay } : {}) } : {}),
  }
}

// The row's statistics (and its curve, when the comparison kept one).
export function runDraftOf(c: StrategyComparison, row: Row, strategyId: string): RunDraft | null {
  if (!row.stats) return null
  const index = c.rows.indexOf(row)
  const benchIndex = c.rows.findIndex((r) => r.entry.template === 'buy_hold')
  const benchmark = benchIndex >= 0 ? c.rows[benchIndex].stats : null
  const weekly = row.entry.cadence === 'weekly'
  return {
    strategyId,
    label: `${entryLabel(row.entry)}・${codesOf(c)}（${c.auto ? '每日自動研究' : '策略比較'}）`,
    ...(weekly ? { cadence: 'weekly' as const, decisionDay: c.decisionDay ?? DEFAULT_DECISION_DAY } : {}),
    template: row.entry.template,
    params: row.entry.params,
    symbols: c.symbol.split(','),
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
    ...(c.auto ? { auto: true } : {}),
  }
}

// Passed out of sample with enough trades to trust it (the comparison's
// 有優勢 reading).
export const reliablePass = (row: Row) => row.entry.role === 'signal' && row.passed === true && !!row.stats && row.stats.full.trades >= INTERPRET_RULES.minTrades
