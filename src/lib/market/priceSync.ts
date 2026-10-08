import type { Holding, StockThesis } from '../storage/schema'
import type { TwseValuation } from './twseValuation'

// Listed TWSE codes: 4–6 digits with an optional letter suffix (e.g. 00679B).
export const TWSE_TICKER = /^\d{4,6}[A-Z]?$/

export function followedTwseTickers(holdings: Holding[], theses: StockThesis[]): string[] {
  const tickers = new Set<string>()
  for (const h of holdings) if (h.currency === 'TWD' && TWSE_TICKER.test(h.ticker)) tickers.add(h.ticker)
  for (const t of theses) if (t.market === 'TW' && TWSE_TICKER.test(t.ticker)) tickers.add(t.ticker)
  return [...tickers]
}

export interface PriceUpdatePlan {
  holdings: { id: string; price: number; date: string }[]
  thesisPrices: Record<string, number>
}

// Which holdings and research cards get a new price from the valuation data.
// Exited research cards keep the price they were closed at.
export function planPriceUpdates(
  holdings: Holding[],
  theses: StockThesis[],
  valuations: Record<string, TwseValuation>,
): PriceUpdatePlan {
  const plan: PriceUpdatePlan = { holdings: [], thesisPrices: {} }
  for (const h of holdings) {
    const v = valuations[h.ticker]
    if (h.currency !== 'TWD' || !v || v.close === null || v.close === h.currentPrice) continue
    plan.holdings.push({ id: h.id, price: v.close, date: v.date })
  }
  for (const t of theses) {
    const v = valuations[t.ticker]
    if (t.market !== 'TW' || t.status === 'exited' || !v || v.close === null || v.close === t.currentPrice) continue
    plan.thesisPrices[t.id] = v.close
  }
  return plan
}
