import type { BacktestRun, PaperAccount, StrategyStatus, TradingStrategy } from '../storage/schema'
import { backtestPasses } from '../calculations/strategyProgress'
import { STRATEGY_STATUS_LABELS, STRATEGY_TEMPLATES, formatSymbol, resolveParams } from './templates'
import { cadenceOf } from './weekly'

// Strategy cards sorted into groups (by symbol, status or template), so a
// list that grows with every comparison stays readable; plus duplicate
// detection and cards worth retiring.

export type GroupBy = 'symbol' | 'status' | 'template' | 'cadence'

export const GROUP_BY_LABELS: Record<GroupBy, string> = { symbol: '標的', status: '狀態', template: '範本', cadence: '頻率' }

type CardLike = Pick<TradingStrategy, 'template' | 'params' | 'symbols' | 'cadence' | 'decisionDay'>

const symbolSet = (symbols: string[]) => [...symbols].sort().join(',')

// Same template, parameters, symbols and cadence: the same strategy.
export const cardKey = (c: CardLike) => {
  const weekly = cadenceOf(c.template, c.cadence) === 'weekly' ? `|weekly${c.decisionDay ?? ''}` : ''
  return `${c.template}|${JSON.stringify(resolveParams(c.template, c.params))}|${symbolSet(c.symbols)}${weekly}`
}

export function findDuplicate(strategies: TradingStrategy[], draft: CardLike): TradingStrategy | undefined {
  const key = cardKey(draft)
  return strategies.find((s) => s.status !== 'retired' && cardKey(s) === key)
}

export interface CardContext {
  runs: BacktestRun[]
  accounts: PaperAccount[]
  names: Record<string, string>
}

// The latest date anything happened to a card: edits, backtests, paper fills.
export function lastActivity(card: TradingStrategy, runs: BacktestRun[], accounts: PaperAccount[]): string {
  const dates = [
    card.updatedAt,
    card.createdAt,
    ...runs.filter((r) => r.strategyId === card.id).map((r) => r.createdAt),
    ...accounts
      .filter((a) => a.strategyId === card.id)
      .flatMap((a) => [a.createdAt, ...a.orders.map((o) => o.filledAt ?? o.createdAt), ...a.equityHistory.map((e) => e.date)]),
  ]
  return dates.filter(Boolean).reduce((a, b) => (b > a ? b : a), '')
}

const STATUS_ORDER: StrategyStatus[] = ['live', 'paper', 'dev', 'retired']

export interface CardGroup {
  key: string
  label: string
  cards: TradingStrategy[]
  summary: string
  // Holds a live or paper card: shown open when there are many groups.
  active: boolean
  retired: boolean
}

export function symbolLabel(symbols: string[], names: Record<string, string>): string {
  if (symbols.length === 0) return '未設定標的'
  return symbols.map((s) => (names[s] ? `${formatSymbol(s)} ${names[s]}` : formatSymbol(s))).join('、')
}

function summaryOf(cards: TradingStrategy[], passed: (c: TradingStrategy) => boolean): string {
  const count = (st: StrategyStatus) => cards.filter((c) => c.status === st).length
  const parts = STATUS_ORDER.filter((st) => count(st) > 0).map((st) => `${STRATEGY_STATUS_LABELS[st]} ${count(st)}`)
  const devPassed = cards.filter((c) => c.status === 'dev' && passed(c)).length
  return `${cards.length} 張：${parts.join('、')}${devPassed > 0 ? `（開發中有 ${devPassed} 張回測通過）` : ''}`
}

export function groupCards(strategies: TradingStrategy[], by: GroupBy, ctx: CardContext): CardGroup[] {
  const passed = (c: TradingStrategy) => ctx.runs.some((r) => r.strategyId === c.id && backtestPasses(r))
  const activity = new Map(strategies.map((c) => [c.id, lastActivity(c, ctx.runs, ctx.accounts)]))
  const byRank = (a: TradingStrategy, b: TradingStrategy) =>
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (activity.get(b.id) ?? '').localeCompare(activity.get(a.id) ?? '')

  const keyOf = (c: TradingStrategy): { key: string; label: string; order: number } => {
    if (by === 'symbol') return { key: symbolSet(c.symbols), label: symbolLabel([...c.symbols].sort(), ctx.names), order: c.symbols.length > 1 ? 1 : 0 }
    if (by === 'cadence') return cadenceOf(c.template, c.cadence) === 'weekly' ? { key: 'weekly', label: '每週判斷', order: 1 } : { key: 'daily', label: '每日判斷', order: 0 }
    if (by === 'template') return { key: c.template, label: STRATEGY_TEMPLATES[c.template].label, order: Object.keys(STRATEGY_TEMPLATES).indexOf(c.template) }
    if (c.status === 'dev') return passed(c) ? { key: 'dev-passed', label: '開發中：回測通過', order: 2 } : { key: 'dev', label: '開發中：未通過或未回測', order: 3 }
    return { key: c.status, label: STRATEGY_STATUS_LABELS[c.status], order: STATUS_ORDER.indexOf(c.status) }
  }

  const groups = new Map<string, { label: string; order: number; cards: TradingStrategy[] }>()
  for (const c of strategies.filter((s) => s.status !== 'retired')) {
    const k = keyOf(c)
    const g = groups.get(k.key) ?? { label: k.label, order: k.order, cards: [] }
    g.cards.push(c)
    groups.set(k.key, g)
  }
  const out: CardGroup[] = [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, cards: g.cards.sort(byRank), summary: summaryOf(g.cards, passed), active: g.cards.some((c) => c.status === 'live' || c.status === 'paper'), retired: false, order: g.order }))
    // Symbols: single ones first, then by how much is going on; others in their fixed order.
    .sort((a, b) => a.order - b.order || (by === 'symbol' ? Number(b.active) - Number(a.active) || b.cards.length - a.cards.length || a.label.localeCompare(b.label) : 0))
    .map(({ order: _order, ...g }) => g)
  const retired = strategies.filter((s) => s.status === 'retired').sort(byRank)
  if (retired.length > 0) out.push({ key: 'retired', label: '已停用', cards: retired, summary: `${retired.length} 張`, active: false, retired: true })
  return out
}

export const CLEANUP_DAYS = 30

export interface CleanupSuggestion {
  card: TradingStrategy
  reason: string
}

// Cards in development whose latest backtest failed, with no paper account
// and nothing done for a month: worth retiring (one by one, by the trader).
export function cleanupSuggestions(strategies: TradingStrategy[], runs: BacktestRun[], accounts: PaperAccount[], today: string): CleanupSuggestion[] {
  const out: CleanupSuggestion[] = []
  for (const card of strategies.filter((s) => s.status === 'dev')) {
    const own = runs.filter((r) => r.strategyId === card.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const latest = own.at(-1)
    if (!latest || backtestPasses(latest) || accounts.some((a) => a.strategyId === card.id)) continue
    const last = lastActivity(card, runs, accounts).slice(0, 10)
    const days = Math.floor((Date.parse(today) - Date.parse(last)) / 86400000)
    if (days <= CLEANUP_DAYS) continue
    out.push({ card, reason: `最近一次回測（${latest.createdAt.slice(0, 10)}）未通過，${days} 天沒有動作，也沒有虛擬帳戶` })
  }
  return out
}

// Chinese names for symbols, from what the trader already keeps.
export function symbolNames(state: {
  watchlist: { symbol: string; name: string }[]
  stockTheses: { ticker: string; name: string; market: string }[]
  paperAccounts: PaperAccount[]
  holdings: { ticker: string; name: string; currency: string }[]
}): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (symbol: string, name: string) => {
    if (name && !out[symbol]) out[symbol] = name
  }
  for (const w of state.watchlist) put(w.symbol, w.name)
  for (const t of state.stockTheses) put(`${t.market}:${t.ticker}`, t.name)
  for (const a of state.paperAccounts) for (const p of a.positions) put(p.symbol, p.name)
  for (const h of state.holdings) put(`${h.currency === 'USD' ? 'US' : 'TW'}:${h.ticker}`, h.name)
  return out
}
