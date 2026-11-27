// 虛擬帳戶總覽 (handbook 10 §7): one cash pool per market, every holding
// with the strategy it belongs to, and each strategy's profit. Prices are
// the ones the last close update saved; TW and US are summed separately,
// never converted.
import type { PaperAccount, PaperFunds } from '../storage/schema'
import { holdingsOf, marketsOf, pendingBuyValue, poolOf, strategyPnl, type Market, type Pool } from './fund'

export type { Market } from './fund'

export interface StrategyRow {
  id: string
  name: string
  market: Market
  strategyId?: string
  positions: number
  holdings: number
  unrealized: number
  realized: number
  pnl: number
  // Profit as a share of the pool's capital.
  pnlShare: number
  pendingBuys: number
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
  stopLoss?: number
  // Share of the pool's equity.
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

export interface MarketTotal extends Pool {
  strategies: number
  unrealized: number
  realized: number
  totalReturn: number
  cashShare: number
  openRiskShare: number
}

export interface PaperOverview {
  strategies: StrategyRow[]
  holdings: HoldingRow[]
  // Only symbols held by more than one strategy.
  shared: SymbolTotal[]
  totals: MarketTotal[]
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0)

export function paperOverview(accounts: PaperAccount[], funds?: PaperFunds): PaperOverview {
  const totals: MarketTotal[] = marketsOf(accounts, funds).map((market) => {
    const pool = poolOf(accounts, market, funds)
    const mine = accounts.filter((a) => a.market === market).map(strategyPnl)
    return {
      ...pool,
      strategies: mine.length,
      unrealized: mine.reduce((s, r) => s + r.unrealized, 0),
      realized: mine.reduce((s, r) => s + r.realized, 0),
      totalReturn: ratio(pool.pnl, pool.capital),
      cashShare: ratio(pool.cash, pool.equity),
      openRiskShare: ratio(pool.openRisk, pool.equity),
    }
  })
  const totalOf = (m: Market) => totals.find((t) => t.market === m)

  const strategies: StrategyRow[] = accounts.map((a) => {
    const { pnl, realized, unrealized } = strategyPnl(a)
    return {
      id: a.id,
      name: a.name,
      market: a.market,
      ...(a.strategyId ? { strategyId: a.strategyId } : {}),
      positions: a.positions.length,
      holdings: holdingsOf(a),
      unrealized,
      realized,
      pnl,
      pnlShare: ratio(pnl, totalOf(a.market)?.capital ?? 0),
      pendingBuys: pendingBuyValue(a),
    }
  })

  const holdings: HoldingRow[] = accounts
    .flatMap((a) =>
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
          ...(p.stopLoss !== undefined ? { stopLoss: p.stopLoss } : {}),
          weight: ratio(value, totalOf(a.market)?.equity ?? 0),
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

  return {
    strategies,
    holdings,
    shared: [...bySymbol.values()].filter((t) => t.accounts > 1).sort((x, y) => y.value - x.value),
    totals,
  }
}
