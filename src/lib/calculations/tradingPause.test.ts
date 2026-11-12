import { describe, expect, it } from 'vitest'
import { pauseStatus, realizedSales } from './tradingPause'
import { createDefaultInvestmentPolicy, type PauseReview, type Trade } from '../storage/schema'

let n = 0
const trade = (date: string, side: 'buy' | 'sell', price: number, over: Partial<Trade> = {}): Trade =>
  ({ id: `t${n}`, createdAt: `${date}T00:00:${String(n++).padStart(2, '0')}Z`, date, ticker: '2330', name: '', side, reason: side === 'buy' ? 'tranche_1' : 'stop_loss', shares: 100, price, currency: 'TWD', checklist: [], emotion: 3, biasNotes: '', ...over }) as Trade

const policy = createDefaultInvestmentPolicy()
const status = (trades: Trade[], reviews: PauseReview[] = [], today = '2026-11-20') =>
  pauseStatus({ trades, reviews, policy, satelliteValueTwd: 1_000_000, fxUsdTwd: 30, today })

describe('realizedSales', () => {
  it('uses the average cost and skips core holdings', () => {
    const sales = realizedSales(
      [trade('2026-01-01', 'buy', 100), trade('2026-01-02', 'buy', 120), trade('2026-01-03', 'sell', 90), trade('2026-01-04', 'buy', 50, { ticker: '0050', reason: 'core_dca' }), trade('2026-01-05', 'sell', 60, { ticker: '0050', reason: 'rebalance' })],
      30,
    )
    expect(sales).toHaveLength(1)
    expect(sales[0].pnlTwd).toBe(-2000)
  })
})

describe('pauseStatus', () => {
  const losers = ['2026-11-03', '2026-11-05', '2026-11-07'].flatMap((d) => [trade(d, 'buy', 100), trade(d, 'sell', 95)])

  it('pauses after the losing streak and counts again after a review', () => {
    expect(status(losers.slice(0, 4)).streakPaused).toBe(false)
    const paused = status(losers)
    expect(paused.streak).toBe(3)
    expect(paused.active).toBe(true)
    const review = { id: 'r', date: '2026-11-07', streak: 3, checks: { followedStops: true, regimeChanged: false, strategyStillValid: true, sizeTooLarge: false }, notes: '' }
    expect(status(losers, [review]).streak).toBe(0)
  })

  it('a winning sale breaks the streak', () => {
    expect(status([...losers.slice(0, 4), trade('2026-11-06', 'buy', 100), trade('2026-11-06', 'sell', 110), ...losers.slice(4)]).streak).toBe(1)
  })

  it('pauses for the rest of the month at the monthly limit', () => {
    const big = [trade('2026-11-02', 'buy', 1000, { shares: 1000 }), trade('2026-11-03', 'sell', 930, { shares: 1000 })]
    expect(status(big).monthPercent).toBeCloseTo(-7)
    expect(status(big).monthPaused).toBe(true)
    expect(status(big, [], '2026-12-01').monthPaused).toBe(false)
  })
})
