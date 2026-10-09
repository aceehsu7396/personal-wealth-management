import { describe, expect, it } from 'vitest'
import { followedTwseTickers, planPriceUpdates } from './priceSync'
import type { Holding, StockThesis } from '../storage/schema'
import type { TwseValuation } from './twseValuation'

const holding = (o: Partial<Holding>): Holding => ({
  id: 'h',
  ticker: '0050',
  name: '',
  sleeve: 'core_tw',
  currency: 'TWD',
  shares: 1,
  avgCost: 1,
  currentPrice: 100,
  createdAt: '',
  ...o,
})

const thesis = (o: Partial<StockThesis>): StockThesis =>
  ({ id: 't', ticker: '2330', market: 'TW', status: 'watch', currentPrice: 900, ...o }) as StockThesis

const val = (ticker: string, close: number | null): TwseValuation => ({
  ticker,
  name: '',
  close,
  dividendYield: null,
  pe: null,
  pb: null,
  period: '',
  date: '2026-10-07',
})

describe('followedTwseTickers', () => {
  it('collects listed TW codes from holdings and research cards only', () => {
    const tickers = followedTwseTickers(
      [holding({}), holding({ ticker: 'VT', currency: 'USD' }), holding({ ticker: 'CASH' })],
      [thesis({}), thesis({ ticker: 'NVDA', market: 'US' }), thesis({ ticker: '00679B' })],
    )
    expect(tickers.sort()).toEqual(['0050', '00679B', '2330'])
  })
})

describe('planPriceUpdates', () => {
  it('updates changed TWD holdings and active TW research cards', () => {
    const plan = planPriceUpdates(
      [holding({}), holding({ id: 'same', ticker: '2330', currentPrice: 950 })],
      [thesis({}), thesis({ id: 'exited', status: 'exited' })],
      { '0050': val('0050', 180), '2330': val('2330', 950) },
    )
    expect(plan.holdings).toEqual([{ id: 'h', price: 180, date: '2026-10-07' }])
    expect(plan.thesisPrices).toEqual({ t: 950 })
  })

  it('never applies TWSE prices to funds', () => {
    const fund = holding({ id: 'f', ticker: '0050', kind: 'fund' })
    expect(followedTwseTickers([fund], [])).toEqual([])
    expect(planPriceUpdates([fund], [], { '0050': val('0050', 180) }).holdings).toEqual([])
  })

  it('skips tickers without a close', () => {
    const plan = planPriceUpdates([holding({})], [], { '0050': val('0050', null) })
    expect(plan.holdings).toEqual([])
  })
})
