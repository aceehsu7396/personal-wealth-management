import type { Holding, StockThesis, TradeReason, TradingStrategy } from '../storage/schema'
import type { SignalReport } from '../research/signals'
import { TradeReasonSchema } from '../storage/schema'

// "Next step" links into the trade log: a research card or strategy card
// opens /portfolio/trades with the order details filled in. Everything is
// only a pre-fill; the pre-trade checklist still runs before saving.

export interface TradeLinkInput {
  ticker: string
  side: 'buy' | 'sell'
  reason: TradeReason
  thesisId?: string
  strategyId?: string
  planId?: string
  shares?: number
  price?: number
  stopLoss?: number
}

export function tradeLink(input: TradeLinkInput): string {
  const params = new URLSearchParams({ ticker: input.ticker, side: input.side, reason: input.reason })
  if (input.thesisId) params.set('thesis', input.thesisId)
  if (input.strategyId) params.set('strategy', input.strategyId)
  if (input.planId) params.set('plan', input.planId)
  if (input.shares) params.set('shares', String(input.shares))
  if (input.price) params.set('price', String(input.price))
  if (input.stopLoss) params.set('stop', String(input.stopLoss))
  return `/portfolio/trades?${params}`
}

export interface TradePrefill {
  side: 'buy' | 'sell'
  reason: TradeReason
  holdingId: string
  ticker: string
  name: string
  sleeve: Holding['sleeve']
  currency: Holding['currency']
  thesisId: string
  strategyId: string
  planId: string
  stopLoss: string
  shares: string
  price: string
}

const bareCode = (t: string) => t.trim().toUpperCase().replace(/^TW:/, '').replace(/\.TWO?$/, '')

// Form values from a trade link; null when the link carries no ticker.
export function prefillFromSearch(
  search: URLSearchParams,
  holdings: Holding[],
  theses: StockThesis[],
  strategies: TradingStrategy[],
): TradePrefill | null {
  const ticker = search.get('ticker')
  if (!ticker) return null
  const code = bareCode(ticker)
  const reason = TradeReasonSchema.safeParse(search.get('reason'))
  const side = search.get('side') === 'sell' ? 'sell' : 'buy'
  const holding = holdings.find((h) => h.kind !== 'fund' && h.shares > 0 && bareCode(h.ticker) === code)
  const thesis = theses.find((t) => t.id === search.get('thesis'))
  const strategy = strategies.find((s) => s.id === search.get('strategy'))
  return {
    side,
    reason: reason.success ? reason.data : side === 'buy' ? 'tranche_1' : 'exit_overvalued',
    holdingId: holding?.id ?? '',
    ticker: code,
    name: holding?.name ?? thesis?.name ?? '',
    sleeve: holding?.sleeve ?? 'satellite_tw',
    currency: holding?.currency ?? 'TWD',
    thesisId: thesis?.id ?? holding?.thesisId ?? '',
    strategyId: strategy?.id ?? holding?.strategyId ?? '',
    planId: search.get('plan') ?? '',
    stopLoss: search.get('stop') ?? '',
    shares: search.get('shares') ?? '',
    price: search.get('price') ?? '',
  }
}

// The next step a research card's advice points to, if any: a trade plan for
// buying or adding a batch, or recording a trim of a third or a full exit.
export function signalTradeLink(report: SignalReport, thesis: Pick<StockThesis, 'id' | 'ticker' | 'verdict' | 'currentPrice'>): { label: string; to: string } | null {
  const price = thesis.currentPrice || undefined
  const base = { ticker: thesis.ticker, thesisId: thesis.id, price }
  // A buy starts from a trade plan (blueprint 02 §3.3); the plan then links
  // to the trade log with everything filled in.
  if (report.action === 'buy' || report.action === 'add') {
    const batch = report.action === 'buy' ? 1 : 2
    return { label: `建立計畫單（第 ${batch} 批）`, to: `/portfolio/plans?thesis=${encodeURIComponent(thesis.id)}` }
  }
  if ((report.action === 'trim' || report.action === 'exit') && report.heldShares) {
    const shares = report.action === 'trim' ? Math.floor(report.heldShares / 3) : report.heldShares
    const reason: TradeReason = thesis.verdict === 'pass' ? 'exit_thesis_broken' : 'exit_overvalued'
    return { label: report.action === 'trim' ? '記錄減碼' : '記錄出清', to: tradeLink({ ...base, side: 'sell', reason, shares }) }
  }
  return null
}
