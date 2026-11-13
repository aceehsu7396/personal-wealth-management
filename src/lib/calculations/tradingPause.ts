import type { InvestmentPolicy, PauseReview, Trade } from '../storage/schema'

// Pause rules for the trading sleeve (handbook 04 §8): stop new
// positions after a run of losing trades until a review is written, and
// for the rest of the month once realised losses reach the monthly limit.

export const SATELLITE_ENTRIES: Trade['reason'][] = ['tranche_1', 'tranche_2', 'tranche_3', 'strategy_entry']

export interface RealizedSale {
  trade: Trade
  pnlTwd: number
}

// Realised result of each trading-sleeve sale at the average cost of the
// shares bought before it. A ticker belongs to the trading sleeve when it
// was bought for a trading-sleeve reason.
export function realizedSales(trades: Trade[], fxUsdTwd: number): RealizedSale[] {
  const satellite = new Set(trades.filter((t) => t.side === 'buy' && SATELLITE_ENTRIES.includes(t.reason)).map((t) => t.ticker))
  const book = new Map<string, { shares: number; cost: number }>()
  const out: RealizedSale[] = []
  const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  for (const t of ordered) {
    const pos = book.get(t.ticker) ?? { shares: 0, cost: 0 }
    if (t.side === 'buy') {
      book.set(t.ticker, { shares: pos.shares + t.shares, cost: pos.cost + t.shares * t.price })
      continue
    }
    const avg = pos.shares > 0 ? pos.cost / pos.shares : t.price
    const sold = Math.min(t.shares, pos.shares)
    book.set(t.ticker, { shares: pos.shares - sold, cost: pos.cost - sold * avg })
    if (satellite.has(t.ticker)) out.push({ trade: t, pnlTwd: (t.price - avg) * t.shares * (t.currency === 'USD' ? fxUsdTwd : 1) })
  }
  return out
}

export interface PauseStatus {
  streak: number
  streakLimit: number
  streakPaused: boolean
  // Net realised result of the trading sleeve this month, in % of its value.
  monthPercent: number
  monthLimit: number
  monthPaused: boolean
  active: boolean
  lastReview: PauseReview | null
}

export const REVIEW_QUESTIONS = [
  { key: 'followedStops', label: '每筆都照計畫停損了嗎？' },
  { key: 'regimeChanged', label: '局勢是不是改變了？' },
  { key: 'strategyStillValid', label: '策略的優勢還在嗎（和回測相比）？' },
  { key: 'sizeTooLarge', label: '部位是不是太大？' },
] as const

export function pauseStatus(input: {
  trades: Trade[]
  reviews: PauseReview[]
  policy: InvestmentPolicy
  satelliteValueTwd: number
  fxUsdTwd: number
  today: string
}): PauseStatus {
  const { policy, today } = input
  const sales = realizedSales(input.trades, input.fxUsdTwd)
  const lastReview = [...input.reviews].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null
  let streak = 0
  for (const s of [...sales].reverse()) {
    if (lastReview && s.trade.date <= lastReview.date) break
    if (s.pnlTwd >= 0) break
    streak++
  }
  const month = today.slice(0, 7)
  const monthPnl = sales.filter((s) => s.trade.date.slice(0, 7) === month).reduce((a, s) => a + s.pnlTwd, 0)
  const monthPercent = input.satelliteValueTwd > 0 ? (monthPnl / input.satelliteValueTwd) * 100 : 0
  const streakPaused = streak >= policy.maxConsecutiveLosses
  const monthPaused = monthPercent <= -policy.monthlyLossLimitPercent
  return {
    streak,
    streakLimit: policy.maxConsecutiveLosses,
    streakPaused,
    monthPercent,
    monthLimit: policy.monthlyLossLimitPercent,
    monthPaused,
    active: streakPaused || monthPaused,
    lastReview,
  }
}
