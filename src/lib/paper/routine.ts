import type { InvestmentPolicy, PaperAccount, TradingStrategy } from '../storage/schema'
import type { RegimeContext } from '../market/regime'
import { fetchLatestTwseBar, isoDaysAgo, TWSE_REQUEST_GAP_MS } from '../market/priceHistory'
import { symbolStatus } from '../backtest/engine'
import { loadChipData, loadPriceData } from '../backtest/data'
import { STRATEGY_TEMPLATES, formatSymbol } from '../backtest/templates'
import { updatePrices, type Quote } from './paperAccount'
import { assistantItems, withSnapshot } from './assistant'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Latest daily bars for TW symbols (TWSE); US prices come from the form.
export async function fetchQuotes(symbols: string[], today: string, onStep: (s: string) => void): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {}
  for (const [i, symbol] of symbols.filter((s) => s.startsWith('TW:')).entries()) {
    if (i > 0) await sleep(TWSE_REQUEST_GAP_MS)
    onStep(`取得 ${formatSymbol(symbol)} 最新收盤價…`)
    const bar = await fetchLatestTwseBar(symbol.slice(3), today)
    if (bar) out[symbol] = { price: bar.close, date: bar.date, open: bar.open, high: bar.high, low: bar.low }
  }
  return out
}

// Symbols whose price an account needs: positions and open orders.
export const priceSymbols = (account: PaperAccount) => [
  ...new Set([...account.positions.map((p) => p.symbol), ...account.orders.filter((o) => o.status === 'open').map((o) => o.symbol)]),
]

export interface RoutineDeps {
  fetchQuotes: typeof fetchQuotes
  loadPriceData: typeof loadPriceData
  loadChipData: typeof loadChipData
}

const defaultDeps: RoutineDeps = { fetchQuotes, loadPriceData, loadChipData }

export interface AdviceInput {
  account: PaperAccount
  strategy: TradingStrategy
  policy: InvestmentPolicy
  regime: RegimeContext | null
  today: string
  onStep: (s: string) => void
  // The site-wide weekly decision day, for weekly cards without their own.
  weeklyDecisionDay?: number
}

// Today's suggestions for an account (handbook 10 §7), saved on it.
export async function adviseAccount({ account, strategy, policy, regime, today, onStep, weeklyDecisionDay }: AdviceInput, deps: RoutineDeps = defaultDeps): Promise<PaperAccount> {
  const symbols = [...new Set([...strategy.symbols, ...account.positions.map((p) => p.symbol)])]
  const data = await deps.loadPriceData(symbols, isoDaysAgo(today, 1), today, (p) => onStep(`下載 ${formatSymbol(p.symbol)} ${p.done}/${p.total}`))
  const held = Object.fromEntries(account.positions.map((p) => [p.symbol, { shares: p.shares, openedAt: p.openedAt }]))
  const chips = STRATEGY_TEMPLATES[strategy.template].chipData
    ? await deps.loadChipData(symbols, isoDaysAgo(today, 1), (p) => onStep(`下載 ${formatSymbol(p.symbol)} 法人買賣超 ${p.done + 1}/${p.total}`))
    : undefined
  const statuses = symbolStatus(strategy.template, strategy.params, data, held, chips, {
    cadence: strategy.cadence,
    decisionDay: strategy.decisionDay ?? weeklyDecisionDay,
    today,
  })
  return withSnapshot(account, assistantItems({ strategy, account, statuses, data, policy, regime }), new Date().toISOString())
}

// Accounts the daily routine runs: linked to a card in paper trading.
export function routineAccounts(accounts: PaperAccount[], strategies: TradingStrategy[]): { account: PaperAccount; strategy: TradingStrategy }[] {
  return accounts.flatMap((account) => {
    const strategy = strategies.find((s) => s.id === account.strategyId && s.status === 'paper')
    return strategy ? [{ account, strategy }] : []
  })
}

export interface RoutineInput {
  accounts: PaperAccount[]
  strategies: TradingStrategy[]
  policy: InvestmentPolicy
  regime: RegimeContext | null
  today: string
  onStep: (s: string) => void
  weeklyDecisionDay?: number
  // The latest saved account, and where to save it: each step builds
  // on what the previous one saved.
  latest: (id: string) => PaperAccount
  save: (account: PaperAccount) => void
}

export interface RoutineResult {
  done: string[]
  failed: { name: string; error: unknown }[]
}

// The day's paper work in one go: update prices (fills open orders and
// triggers stops), then today's suggestions. Orders stay with the trader.
export async function runPaperRoutine(input: RoutineInput, deps: RoutineDeps = defaultDeps): Promise<RoutineResult> {
  const result: RoutineResult = { done: [], failed: [] }
  for (const { account, strategy } of routineAccounts(input.accounts, input.strategies)) {
    const step = (s: string) => input.onStep(`${account.name}：${s}`)
    try {
      if (account.market === 'TW') {
        const quotes = await deps.fetchQuotes(priceSymbols(input.latest(account.id)), input.today, step)
        input.save(updatePrices(input.latest(account.id), quotes))
      }
      input.save(await adviseAccount({ account: input.latest(account.id), strategy, policy: input.policy, regime: input.regime, today: input.today, onStep: step, weeklyDecisionDay: input.weeklyDecisionDay }, deps))
      result.done.push(account.name)
    } catch (error) {
      result.failed.push({ name: account.name, error })
    }
  }
  return result
}
