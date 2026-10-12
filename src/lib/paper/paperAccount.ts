import type { PaperAccount, PaperOrder, PaperPosition } from '../storage/schema'
import { marketCosts, type BacktestCosts } from '../backtest/engine'
import { monthsBetween } from '../calculations/traderReadiness'

// Paper trading: pure functions that take an account and return the
// updated account. Fills use daily data: market orders at the latest
// close; limit and stop orders when the day's range reaches their price.

// The latest daily bar; price is the close.
export interface Quote {
  price: number
  date: string
  open?: number
  high?: number
  low?: number
}

// A price touched during the day fills at that price, or at the open when
// the day already opened beyond it.
function touched(q: Quote, level: number, direction: 'down' | 'up'): number | null {
  const open = q.open ?? q.price
  const low = q.low ?? Math.min(open, q.price)
  const high = q.high ?? Math.max(open, q.price)
  if (direction === 'down') return low <= level ? Math.min(open, level) : null
  return high >= level ? Math.max(open, level) : null
}

export interface NewOrder {
  symbol: string
  name: string
  side: PaperOrder['side']
  type: PaperOrder['type']
  price?: number
  shares: number
  stopLoss?: number
  reason: string
  emotion?: number
}

export class PaperOrderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaperOrderError'
  }
}

const costs: BacktestCosts = marketCosts(1, 0)

function fee(symbol: string, value: number): number {
  return value > 0 ? Math.max(costs.minFee(symbol), value * costs.feeRate(symbol)) : 0
}

export function equityOf(account: PaperAccount): number {
  return account.cash + account.positions.reduce((a, p) => a + p.shares * p.lastPrice, 0)
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
}

// Fills an order at `price` on `date`, updating cash and positions.
function fill(account: PaperAccount, order: PaperOrder, price: number, date: string): PaperAccount {
  const value = order.shares * price
  const position = account.positions.find((p) => p.symbol === order.symbol)
  if (order.side === 'buy') {
    const buyFee = fee(order.symbol, value)
    if (value + buyFee > account.cash + 1e-6) throw new PaperOrderError('現金不足')
    const shares = (position?.shares ?? 0) + order.shares
    const next: PaperPosition = {
      symbol: order.symbol,
      name: order.name || position?.name || '',
      shares,
      // Average cost includes the buy fee, so P&L is net of costs.
      avgCost: ((position?.avgCost ?? 0) * (position?.shares ?? 0) + value + buyFee) / shares,
      lastPrice: price,
      lastPriceDate: date,
      stopLoss: order.stopLoss ?? position?.stopLoss,
      openedAt: position?.openedAt ?? date,
    }
    return {
      ...account,
      cash: account.cash - value - buyFee,
      positions: [...account.positions.filter((p) => p.symbol !== order.symbol), next],
      orders: account.orders.map((o) =>
        o.id === order.id ? { ...o, status: 'filled', filledAt: date, fillPrice: price, fee: buyFee } : o,
      ),
    }
  }

  if (!position || position.shares < order.shares) throw new PaperOrderError('賣出股數超過持有股數')
  const sellCosts = fee(order.symbol, value) + value * costs.taxRate(order.symbol)
  const realizedPnl = value - sellCosts - position.avgCost * order.shares
  const risk = position.stopLoss !== undefined ? position.avgCost - position.stopLoss : 0
  const remaining = position.shares - order.shares
  return {
    ...account,
    cash: account.cash + value - sellCosts,
    positions:
      remaining > 0
        ? account.positions.map((p) => (p.symbol === order.symbol ? { ...p, shares: remaining, lastPrice: price, lastPriceDate: date } : p))
        : account.positions.filter((p) => p.symbol !== order.symbol),
    orders: account.orders.map((o) =>
      o.id === order.id
        ? {
            ...o,
            status: 'filled',
            filledAt: date,
            fillPrice: price,
            fee: sellCosts,
            realizedPnl,
            rMultiple: risk > 0 ? (price - position.avgCost) / risk : undefined,
          }
        : o,
    ),
  }
}

// Places an order. A market order needs a quote and fills at once; limit
// and stop orders wait for updatePrices.
export function placeOrder(account: PaperAccount, input: NewOrder, quote?: Quote, now = new Date().toISOString()): PaperAccount {
  if (!(input.shares > 0) || !Number.isInteger(input.shares)) throw new PaperOrderError('股數須為正整數')
  if (input.type !== 'market' && !(input.price && input.price > 0)) throw new PaperOrderError('限價單與停損單需要價格')
  if (input.side === 'buy' && input.stopLoss !== undefined && quote && input.stopLoss >= quote.price) {
    throw new PaperOrderError('停損價須低於買進價')
  }
  if (input.side === 'buy' && input.type === 'stop') throw new PaperOrderError('停損單只用於賣出')
  const order: PaperOrder = { id: newId(), createdAt: now, status: 'open', ...input, reason: input.reason }
  const withOrder = { ...account, orders: [...account.orders, order] }
  if (input.type !== 'market') return withOrder
  if (!quote) throw new PaperOrderError('市價單需要最新價格')
  return snapshot(fill(withOrder, order, quote.price, quote.date), quote.date)
}

export function cancelOrder(account: PaperAccount, orderId: string): PaperAccount {
  return {
    ...account,
    orders: account.orders.map((o) => (o.id === orderId && o.status === 'open' ? { ...o, status: 'cancelled' } : o)),
  }
}

export function setStopLoss(account: PaperAccount, symbol: string, stopLoss: number | undefined): PaperAccount {
  return { ...account, positions: account.positions.map((p) => (p.symbol === symbol ? { ...p, stopLoss } : p)) }
}

// Records today's equity (one point per date).
function snapshot(account: PaperAccount, date: string): PaperAccount {
  const point = { date, equity: equityOf(account) }
  return {
    ...account,
    equityHistory: [...account.equityHistory.filter((p) => p.date !== date), point].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

// Applies new daily quotes: marks positions, triggers stops (position stop
// losses and stop orders), fills limit orders, then records equity.
export function updatePrices(account: PaperAccount, quotes: Record<string, Quote>): PaperAccount {
  let next: PaperAccount = {
    ...account,
    positions: account.positions.map((p) =>
      quotes[p.symbol] ? { ...p, lastPrice: quotes[p.symbol].price, lastPriceDate: quotes[p.symbol].date } : p,
    ),
  }

  for (const order of next.orders.filter((o) => o.status === 'open')) {
    const q = quotes[order.symbol]
    // Orders only fill on bars after the day they were placed.
    if (!q || q.date <= order.createdAt.slice(0, 10) || order.price === undefined) continue
    const price =
      order.type === 'limit' && order.side === 'sell'
        ? touched(q, order.price, 'up')
        : touched(q, order.price, 'down')
    if (price === null) continue
    try {
      next = fill(next, order, price, q.date)
    } catch {
      next = cancelOrder(next, order.id)
    }
  }

  for (const p of [...next.positions]) {
    const q = quotes[p.symbol]
    if (!q || p.stopLoss === undefined || q.date <= p.openedAt) continue
    const price = touched(q, p.stopLoss, 'down')
    if (price === null || !next.positions.some((x) => x.symbol === p.symbol)) continue
    const order: PaperOrder = {
      id: newId(),
      createdAt: `${q.date}T00:00:00.000Z`,
      symbol: p.symbol,
      name: p.name,
      side: 'sell',
      type: 'stop',
      price: p.stopLoss,
      shares: p.shares,
      status: 'open',
      reason: '停損觸發（自動）',
    }
    next = fill({ ...next, orders: [...next.orders, order] }, order, price, q.date)
  }

  const latest = Object.values(quotes).map((q) => q.date).sort().pop()
  return latest ? snapshot(next, latest) : next
}

export interface PaperStats {
  equity: number
  totalReturn: number
  maxDrawdown: number
  fills: number
  closed: number
  winRate: number | null
  avgR: number | null
  months: number
}

export function paperStats(account: PaperAccount, today: string): PaperStats {
  const equity = equityOf(account)
  let peak = account.initialCash
  let maxDrawdown = 0
  for (const p of account.equityHistory) {
    peak = Math.max(peak, p.equity)
    maxDrawdown = Math.min(maxDrawdown, p.equity / peak - 1)
  }
  const filled = account.orders.filter((o) => o.status === 'filled')
  const sells = filled.filter((o) => o.side === 'sell' && o.realizedPnl !== undefined)
  const rs = sells.map((o) => o.rMultiple).filter((r): r is number => r !== undefined)
  const first = filled.map((o) => o.filledAt ?? '').sort()[0]
  return {
    equity,
    totalReturn: account.initialCash > 0 ? equity / account.initialCash - 1 : 0,
    maxDrawdown,
    fills: filled.length,
    closed: sells.length,
    winRate: sells.length > 0 ? sells.filter((o) => (o.realizedPnl ?? 0) > 0).length / sells.length : null,
    avgR: rs.length > 0 ? rs.reduce((a, v) => a + v, 0) / rs.length : null,
    months: first ? Math.max(monthsBetween(first.slice(0, 10), today), 0) : 0,
  }
}
