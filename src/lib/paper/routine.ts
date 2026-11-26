import type { InvestmentPolicy, PaperAccount, TradingStrategy } from '../storage/schema'
import type { RegimeContext } from '../market/regime'
import { fetchLatestTwseBar, isoDaysAgo, TWSE_REQUEST_GAP_MS } from '../market/priceHistory'
import { fetchDataset } from '../research/finmind'
import { symbolStatus } from '../backtest/engine'
import { loadChipData, loadPriceData } from '../backtest/data'
import { STRATEGY_TEMPLATES, formatSymbol } from '../backtest/templates'
import { updatePrices, type Quote } from './paperAccount'
import { assistantItems, withSnapshot } from './assistant'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The latest daily bar from FinMind: OTC (上櫃) and US symbols, and the
// fallback when TWSE has nothing.
async function finMindBar(symbol: string, today: string): Promise<Quote | null> {
  const [market, code] = symbol.split(':')
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10)
  if (market === 'US') {
    const rows = await fetchDataset<{ date: string; Open: number; High: number; Low: number; Close: number }>('USStockPrice', code, start)
    const r = rows.filter((x) => x.Close > 0).at(-1)
    return r ? { price: r.Close, date: r.date, open: r.Open, high: r.High, low: r.Low } : null
  }
  const rows = await fetchDataset<{ date: string; open: number; max: number; min: number; close: number }>('TaiwanStockPrice', code, start)
  const r = rows.filter((x) => x.close > 0).at(-1)
  return r ? { price: r.close, date: r.date, open: r.open, high: r.max, low: r.min } : null
}

// Latest daily bars: listed TW symbols from TWSE, then FinMind for OTC
// and US ones (or when TWSE fails). A symbol that fails is reported to
// `onMiss` and skipped, so the others still update.
export async function fetchQuotes(
  symbols: string[],
  today: string,
  onStep: (s: string) => void,
  onMiss: (symbol: string) => void = () => {},
  // Each symbol as it starts (undefined) and finishes (the quote or null).
  onQuote: (symbol: string, quote: Quote | null | undefined) => void = () => {},
): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {}
  let twse = 0
  for (const symbol of symbols) {
    onStep(`取得 ${formatSymbol(symbol)} 最新收盤價…`)
    onQuote(symbol, undefined)
    let quote: Quote | null = null
    if (symbol.startsWith('TW:')) {
      if (twse++ > 0) await sleep(TWSE_REQUEST_GAP_MS)
      try {
        const bar = await fetchLatestTwseBar(symbol.slice(3), today)
        if (bar) quote = { price: bar.close, date: bar.date, open: bar.open, high: bar.high, low: bar.low }
      } catch {
        // Fall back to FinMind below.
      }
    }
    if (!quote) {
      try {
        quote = await finMindBar(symbol, today)
      } catch {
        quote = null
      }
    }
    if (quote) out[symbol] = quote
    else onMiss(symbol)
    onQuote(symbol, quote)
  }
  return out
}

// Symbols whose price an account needs: positions, open orders and the
// linked card's symbols in the account's market.
export const priceSymbols = (account: PaperAccount, strategy?: Pick<TradingStrategy, 'symbols'>) => [
  ...new Set([
    ...account.positions.map((p) => p.symbol),
    ...account.orders.filter((o) => o.status === 'open').map((o) => o.symbol),
    ...(strategy?.symbols ?? []).filter((s) => s.startsWith(`${account.market}:`)),
  ]),
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
  // Every paper account, for the trading capital (handbook 10 §7).
  accounts?: PaperAccount[]
}

// Today's suggestions for an account (handbook 10 §7), saved on it.
export async function adviseAccount({ account, strategy, policy, regime, today, onStep, weeklyDecisionDay, accounts }: AdviceInput, deps: RoutineDeps = defaultDeps): Promise<PaperAccount> {
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
  return withSnapshot(account, assistantItems({ strategy, account, statuses, data, policy, regime, accounts }), new Date().toISOString())
}

// Accounts the daily routine gives suggestions: linked to a card in paper
// trading. Every account gets the latest closes.
export function routineAccounts(accounts: PaperAccount[], strategies: TradingStrategy[]): { account: PaperAccount; strategy: TradingStrategy }[] {
  return accounts.flatMap((account) => {
    const strategy = strategies.find((s) => s.id === account.strategyId && s.status === 'paper')
    return strategy ? [{ account, strategy }] : []
  })
}

// What the routine is doing, for the progress panel.
export interface SymbolProgress {
  symbol: string
  status: 'pending' | 'fetching' | 'done' | 'missing' | 'manual'
  price?: number
  date?: string
}

export interface AccountProgress {
  id: string
  name: string
  status: 'pending' | 'prices' | 'advising' | 'done' | 'failed'
  note?: string
}

export interface RoutineProgress {
  phase: 'prices' | 'advice' | 'finished'
  symbols: SymbolProgress[]
  accounts: AccountProgress[]
}

export interface RoutineInput {
  accounts: PaperAccount[]
  strategies: TradingStrategy[]
  policy: InvestmentPolicy
  regime: RegimeContext | null
  today: string
  onStep: (s: string) => void
  weeklyDecisionDay?: number
  // Prices typed in by hand (US accounts), over what was fetched.
  manual?: Record<string, Quote>
  // The latest saved account, and where to save it: each step builds
  // on what the previous one saved.
  latest: (id: string) => PaperAccount
  save: (account: PaperAccount) => void
  onProgress?: (progress: RoutineProgress) => void
}

export interface RoutineResult {
  done: string[]
  failed: { name: string; error: unknown }[]
  // Symbols no source had a close for.
  missing: string[]
}

// The day's paper work in one go: the latest closes for every account,
// whatever its card (fills open orders and triggers stops; each symbol
// fetched once), then suggestions for the accounts on paper cards. Orders
// stay with the trader.
export async function runPaperRoutine(input: RoutineInput, deps: RoutineDeps = defaultDeps): Promise<RoutineResult> {
  const result: RoutineResult = { done: [], failed: [], missing: [] }
  const advised = routineAccounts(input.accounts, input.strategies)
  const fetched: Record<string, Quote> = {}
  const tried = new Set<string>()
  const strategyOf = (account: PaperAccount) => input.strategies.find((s) => s.id === account.strategyId)
  // Every symbol up front, so the panel shows the whole list from the start.
  const progress: RoutineProgress = {
    phase: 'prices',
    symbols: [...new Set(input.accounts.flatMap((a) => priceSymbols(input.latest(a.id), strategyOf(a))))].map((symbol) => ({ symbol, status: 'pending' })),
    accounts: input.accounts.map((a) => ({ id: a.id, name: a.name, status: 'pending' })),
  }
  const report = () => input.onProgress?.({ phase: progress.phase, symbols: progress.symbols.map((x) => ({ ...x })), accounts: progress.accounts.map((x) => ({ ...x })) })
  const setSymbol = (symbol: string, patch: Omit<SymbolProgress, 'symbol'>) => {
    const i = progress.symbols.findIndex((x) => x.symbol === symbol)
    if (i >= 0) progress.symbols[i] = { symbol, ...patch }
    else progress.symbols.push({ symbol, ...patch })
    report()
  }
  const setAccount = (id: string, patch: Partial<AccountProgress>) => {
    progress.accounts = progress.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a))
    report()
  }
  report()
  for (const account of input.accounts) {
    const strategy = strategyOf(account)
    const step = (s: string) => input.onStep(`${account.name}：${s}`)
    setAccount(account.id, { status: 'prices' })
    try {
      const symbols = priceSymbols(input.latest(account.id), strategy)
      const need = symbols.filter((s) => !tried.has(s))
      Object.assign(
        fetched,
        await deps.fetchQuotes(need, input.today, step, (s) => result.missing.push(s), (s, q) =>
          setSymbol(s, q === undefined ? { status: 'fetching' } : q ? { status: 'done', price: q.price, date: q.date } : { status: 'missing' }),
        ),
      )
      for (const s of need) tried.add(s)
      const quotes = Object.fromEntries(symbols.filter((s) => fetched[s]).map((s) => [s, fetched[s]]))
      for (const s of symbols) {
        const typed = input.manual?.[s]
        if (!typed) continue
        quotes[s] = typed
        setSymbol(s, { status: 'manual', price: typed.price, date: typed.date })
      }
      input.save(updatePrices(input.latest(account.id), quotes))
      if (strategy && advised.some((x) => x.account.id === account.id) && STRATEGY_TEMPLATES[strategy.template].backtestable) {
        progress.phase = 'advice'
        setAccount(account.id, { status: 'advising' })
        input.save(await adviseAccount({ account: input.latest(account.id), strategy, policy: input.policy, regime: input.regime, today: input.today, onStep: step, weeklyDecisionDay: input.weeklyDecisionDay, accounts: input.accounts.map((a) => input.latest(a.id)) }, deps))
        progress.phase = 'prices'
      }
      result.done.push(account.name)
      setAccount(account.id, { status: 'done' })
    } catch (error) {
      result.failed.push({ name: account.name, error })
      // Symbols this account left half done.
      for (const x of progress.symbols) if (x.status === 'fetching') setSymbol(x.symbol, { status: 'missing' })
      setAccount(account.id, { status: 'failed', note: error instanceof Error ? error.message : String(error) })
    }
  }
  progress.phase = 'finished'
  report()
  return result
}
