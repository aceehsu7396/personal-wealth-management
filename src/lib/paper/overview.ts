// 虛擬帳戶總覽 (handbook 10 §7): every account's money, holdings and
// profit on one screen, with cash set apart. Prices are the ones the last
// close update saved; TW and US accounts are summed separately, never
// converted.
import type { PaperAccount } from '../storage/schema'
import { equityOf } from './paperAccount'
import { sleeveOf } from './assistant'

export type Market = PaperAccount['market']

export interface AccountRow {
  id: string
  name: string
  market: Market
  strategyId?: string
  initialCash: number
  cash: number
  holdings: number
  equity: number
  unrealized: number
  realized: number
  pnl: number
  totalReturn: number
  cashShare: number
  // Open buy orders: cash they will use when filled (not yet deducted).
  pendingBuys: number
  available: number
}

export interface HoldingRow {
  accountId: string
  accountName: string
  market: Market
  symbol: string
  name: string
  shares: number
  avgCost: number
  lastPrice: number
  lastPriceDate: string
  value: number
  unrealized: number
  gain: number
  // Share of that account's equity.
  weight: number
}

export interface SymbolTotal {
  market: Market
  symbol: string
  name: string
  accounts: number
  shares: number
  value: number
  unrealized: number
}

export interface MarketTotal {
  market: Market
  accounts: number
  initialCash: number
  cash: number
  holdings: number
  equity: number
  unrealized: number
  realized: number
  pnl: number
  totalReturn: number
  cashShare: number
  pendingBuys: number
  available: number
  // Every position's stop risk together (handbook 10 §7), its share of the
  // equity, and positions without a stop (not counted).
  openRisk: number
  openRiskShare: number
  unstopped: number
}

export interface PaperOverview {
  accounts: AccountRow[]
  holdings: HoldingRow[]
  // Only symbols held by more than one account.
  shared: SymbolTotal[]
  totals: MarketTotal[]
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0)

// Cash an open buy order will take: its limit price, or the latest known
// price of a market order waiting for the next open.
function pendingBuyValue(account: PaperAccount): number {
  return account.orders
    .filter((o) => o.status === 'open' && o.side === 'buy')
    .reduce((sum, o) => {
      const price = o.type === 'market' ? (account.positions.find((p) => p.symbol === o.symbol)?.lastPrice ?? account.quotes?.[o.symbol]?.price ?? o.price ?? 0) : (o.price ?? 0)
      return sum + o.shares * price
    }, 0)
}

function accountRow(a: PaperAccount): AccountRow {
  const equity = equityOf(a)
  const holdings = equity - a.cash
  const unrealized = a.positions.reduce((s, p) => s + (p.lastPrice - p.avgCost) * p.shares, 0)
  const realized = a.orders.reduce((s, o) => s + (o.status === 'filled' && o.side === 'sell' ? (o.realizedPnl ?? 0) : 0), 0)
  const pendingBuys = pendingBuyValue(a)
  return {
    id: a.id,
    name: a.name,
    market: a.market,
    ...(a.strategyId ? { strategyId: a.strategyId } : {}),
    initialCash: a.initialCash,
    cash: a.cash,
    holdings,
    equity,
    unrealized,
    realized,
    pnl: equity - a.initialCash,
    totalReturn: ratio(equity - a.initialCash, a.initialCash),
    cashShare: ratio(a.cash, equity),
    pendingBuys,
    available: a.cash - pendingBuys,
  }
}

export function paperOverview(accounts: PaperAccount[]): PaperOverview {
  const rows = accounts.map(accountRow)
  const holdings: HoldingRow[] = accounts
    .flatMap((a, i) =>
      a.positions.map((p) => {
        const value = p.shares * p.lastPrice
        return {
          accountId: a.id,
          accountName: a.name,
          market: a.market,
          symbol: p.symbol,
          name: p.name,
          shares: p.shares,
          avgCost: p.avgCost,
          lastPrice: p.lastPrice,
          lastPriceDate: p.lastPriceDate,
          value,
          unrealized: (p.lastPrice - p.avgCost) * p.shares,
          gain: ratio(p.lastPrice, p.avgCost) - 1,
          weight: ratio(value, rows[i].equity),
        }
      }),
    )
    .sort((x, y) => (x.market === y.market ? y.value - x.value : x.market === 'TW' ? -1 : 1))

  const bySymbol = new Map<string, SymbolTotal>()
  for (const h of holdings) {
    const key = `${h.market}|${h.symbol}`
    const t = bySymbol.get(key) ?? { market: h.market, symbol: h.symbol, name: h.name, accounts: 0, shares: 0, value: 0, unrealized: 0 }
    t.accounts += 1
    t.shares += h.shares
    t.value += h.value
    t.unrealized += h.unrealized
    t.name ||= h.name
    bySymbol.set(key, t)
  }

  const totals: MarketTotal[] = (['TW', 'US'] as const).flatMap((market) => {
    const rs = rows.filter((r) => r.market === market)
    if (rs.length === 0) return []
    const sum = (f: (r: AccountRow) => number) => rs.reduce((s, r) => s + f(r), 0)
    const equity = sum((r) => r.equity)
    const initialCash = sum((r) => r.initialCash)
    const cash = sum((r) => r.cash)
    const pendingBuys = sum((r) => r.pendingBuys)
    const sleeve = sleeveOf(accounts, market)
    return [
      {
        market,
        accounts: rs.length,
        initialCash,
        cash,
        holdings: sum((r) => r.holdings),
        equity,
        unrealized: sum((r) => r.unrealized),
        realized: sum((r) => r.realized),
        pnl: equity - initialCash,
        totalReturn: ratio(equity - initialCash, initialCash),
        cashShare: ratio(cash, equity),
        pendingBuys,
        available: cash - pendingBuys,
        openRisk: sleeve.openRisk,
        openRiskShare: ratio(sleeve.openRisk, equity),
        unstopped: sleeve.unstopped,
      },
    ]
  })

  return {
    accounts: rows,
    holdings,
    shared: [...bySymbol.values()].filter((t) => t.accounts > 1).sort((x, y) => y.value - x.value),
    totals,
  }
}
