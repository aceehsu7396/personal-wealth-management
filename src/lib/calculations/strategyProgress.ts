import type { BacktestRun, PaperAccount, PaperOrder, TradingStrategy } from '../storage/schema'
import { monthsBetween } from './traderReadiness'
import { outOfSampleVerdict } from '../backtest/passRule'

// A strategy has proven itself on paper after this much forward practice.
export const PAPER_RULES = { months: 3, fills: 10 } as const

export function paperFills(account: PaperAccount): PaperOrder[] {
  return account.orders
    .filter((o) => o.status === 'filled' && o.filledAt)
    .sort((a, b) => (a.filledAt ?? '').localeCompare(b.filledAt ?? ''))
}

export function paperProgress(account: PaperAccount, today: string): { months: number; fills: number; qualifies: boolean } {
  const fills = paperFills(account)
  const months = fills.length > 0 ? Math.max(monthsBetween(fills[0].filledAt!.slice(0, 10), today), 0) : 0
  return { months, fills: fills.length, qualifies: months >= PAPER_RULES.months && fills.length >= PAPER_RULES.fills }
}

// Out of sample, beats buy-and-hold on return or on risk-adjusted terms.
export function backtestPasses(run: BacktestRun): boolean {
  return outOfSampleVerdict(run.stats.outOfSample, run.benchmark.outOfSample).passed
}

// Strategies with a linked paper account that meets PAPER_RULES.
export function paperProvenStrategies(
  strategies: TradingStrategy[],
  accounts: PaperAccount[],
  today: string,
): TradingStrategy[] {
  return strategies.filter((s) =>
    accounts.some((a) => a.strategyId === s.id && paperProgress(a, today).qualifies),
  )
}

export interface LiveGate {
  backtestPassed: boolean
  paperProven: boolean
  allowed: boolean
}

// A strategy may trade real money once one of its own backtests passed
// out of sample and a linked paper account met PAPER_RULES.
export function liveGate(
  strategy: TradingStrategy,
  runs: BacktestRun[],
  accounts: PaperAccount[],
  today: string,
): LiveGate {
  const backtestPassed = runs.some((r) => r.strategyId === strategy.id && backtestPasses(r))
  const paperProven = accounts.some((a) => a.strategyId === strategy.id && paperProgress(a, today).qualifies)
  return { backtestPassed, paperProven, allowed: backtestPassed && paperProven }
}
