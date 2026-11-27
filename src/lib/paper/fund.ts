// The paper cash pool (handbook 10 §7): one per market, shared by every
// strategy in paper trading. A strategy has no money of its own; its cash
// is what it moved, so the pool's cash is the fund's capital plus every
// strategy's cash. Accounts from before the pool still carry their own
// initial cash, which counts as capital here (and is moved into the fund
// when the data loads). TW and US are never mixed.
import type { PaperAccount, PaperFunds } from '../storage/schema'

export type Market = PaperAccount['market']

export interface Pool {
  market: Market
  // Money put in.
  capital: number
  cash: number
  holdings: number
  // cash + holdings: the trading capital risk is measured against.
  equity: number
  pnl: number
  // Open buy orders: cash they will use when filled (not yet deducted).
  pendingBuys: number
  available: number
  // Shares × (price − stop) over every position with a stop below price,
  // and positions without a stop (not counted).
  openRisk: number
  unstopped: number
}

// Cash an open buy order will take: its limit price, or the latest known
// price of a market order waiting for the next open.
export function pendingBuyValue(account: PaperAccount): number {
  return account.orders
    .filter((o) => o.status === 'open' && o.side === 'buy')
    .reduce((sum, o) => {
      const price = o.type === 'market' ? (account.positions.find((p) => p.symbol === o.symbol)?.lastPrice ?? account.quotes?.[o.symbol]?.price ?? o.price ?? 0) : (o.price ?? 0)
      return sum + o.shares * price
    }, 0)
}

export const holdingsOf = (account: PaperAccount) => account.positions.reduce((a, p) => a + p.shares * p.lastPrice, 0)

export function poolOf(accounts: PaperAccount[], market: Market, funds?: PaperFunds): Pool {
  const mine = accounts.filter((a) => a.market === market)
  const fund = funds?.[market]?.capital ?? 0
  const capital = fund + mine.reduce((s, a) => s + a.initialCash, 0)
  const cash = fund + mine.reduce((s, a) => s + a.cash, 0)
  const holdings = mine.reduce((s, a) => s + holdingsOf(a), 0)
  const pendingBuys = mine.reduce((s, a) => s + pendingBuyValue(a), 0)
  let openRisk = 0
  let unstopped = 0
  for (const a of mine)
    for (const p of a.positions) {
      if (p.stopLoss === undefined) unstopped += 1
      else openRisk += p.shares * Math.max(p.lastPrice - p.stopLoss, 0)
    }
  return { market, capital, cash, holdings, equity: cash + holdings, pnl: cash + holdings - capital, pendingBuys, available: cash - pendingBuys, openRisk, unstopped }
}

// Markets with a fund or a strategy, TW first.
export function marketsOf(accounts: PaperAccount[], funds?: PaperFunds): Market[] {
  return (['TW', 'US'] as const).filter((m) => funds?.[m] !== undefined || accounts.some((a) => a.market === m))
}

// A strategy's profit: what it moved plus what it holds (its equity history
// records the same), the realized part from its sales.
export function strategyPnl(account: PaperAccount): { pnl: number; realized: number; unrealized: number } {
  const realized = account.orders.reduce((s, o) => s + (o.status === 'filled' && o.side === 'sell' ? (o.realizedPnl ?? 0) : 0), 0)
  const unrealized = account.positions.reduce((s, p) => s + (p.lastPrice - p.avgCost) * p.shares, 0)
  return { pnl: account.cash - account.initialCash + holdingsOf(account), realized, unrealized }
}

// The pool's equity by date: capital plus each strategy's profit on that
// date (its last recorded point; nothing before its first).
export function poolHistory(accounts: PaperAccount[], market: Market, funds?: PaperFunds): { date: string; equity: number }[] {
  const mine = accounts.filter((a) => a.market === market)
  const capital = poolOf(accounts, market, funds).capital
  const dates = [...new Set(mine.flatMap((a) => a.equityHistory.map((p) => p.date)))].sort()
  return dates.map((date) => ({
    date,
    equity:
      capital +
      mine.reduce((s, a) => {
        const last = a.equityHistory.filter((p) => p.date <= date).at(-1)
        // Legacy history (before pooling) is the account's equity, not profit.
        return s + (last ? last.equity - a.initialCash : 0)
      }, 0),
  }))
}
