import { describe, expect, it } from 'vitest'
import { createDefaultInvestmentPolicy } from '../storage/schema'
import { rateAuto } from './rating'
import type { AutoResearch } from './autoResearch'

const policy = createDefaultInvestmentPolicy()

function stock(o: Record<string, unknown> = {}, price = 950): AutoResearch {
  return {
    fetchedAt: '',
    kind: 'stock',
    name: '',
    industry: '',
    price,
    priceDate: '',
    etf: null,
    stock: {
      asOf: '',
      isFinancial: false,
      epsTtm: 50,
      epsTtmPrev: 40,
      roe: 25,
      grossMargin: 50,
      grossMarginPrev: 48,
      operatingMargin: 30,
      revenueCagr3y: 12,
      epsCagr3y: 15,
      revenueYoyTtm: 8,
      debtRatio: 30,
      currentRatio: 2,
      freeCashFlow: [{ year: '2025', value: 1 }],
      fScore: { score: 7, items: [] },
      redFlags: [],
      dividends: { consecutiveYears: 8, lastYearCash: 10, payoutRatio: 40 },
      valuation: { pe: { current: 20, p20: 14, p50: 20, p80: 26, percentile: 50 }, pb: null, dividendYield: 2, years: 5 },
      lynch: 'stalwart',
      ...o,
    } as AutoResearch['stock'],
  }
}

const tones = (a: AutoResearch) => Object.fromEntries(rateAuto(a, policy)!.dimensions.map((d) => [d.key, d.tone]))

describe('rateAuto (stocks)', () => {
  it('rates a healthy, fairly priced company as strong', () => {
    // Fair values from EPS 50 × 1.15 × P/E 20 ≈ 1150 base, so 950 is below it.
    const r = rateAuto(stock(), policy)!
    expect(r.overall).toBe('strong')
    expect(tones(stock())).toEqual({ quality: 'good', growth: 'good', safety: 'good', valuation: 'good', dividend: 'good' })
  })

  it('flags weak quality, shrinking growth, leverage and an expensive price', () => {
    const weak = stock({ fScore: { score: 4, items: [] }, roe: 6, epsCagr3y: -5, debtRatio: 70 }, 2000)
    expect(tones(weak)).toMatchObject({ quality: 'warn', growth: 'warn', safety: 'warn', valuation: 'warn' })
    expect(rateAuto(weak, policy)!.overall).toBe('weak')
  })

  it('is neutral in between, and caution with one or two warnings', () => {
    expect(tones(stock({ fScore: { score: 5, items: [] }, roe: 9 })).quality).toBe('neutral')
    expect(rateAuto(stock({ dividends: { consecutiveYears: 8, lastYearCash: 10, payoutRatio: 120 } }), policy)!.overall).toBe('caution')
  })

  it('does not hold financials to F-score or debt-ratio rules', () => {
    const bank = stock({ isFinancial: true, fScore: null, roe: 12, debtRatio: 92, currentRatio: null })
    expect(tones(bank)).toMatchObject({ quality: 'good', safety: 'good' })
  })
})

describe('rateAuto (ETFs)', () => {
  const etf = (o: Record<string, unknown> = {}): AutoResearch => ({
    fetchedAt: '',
    kind: 'etf',
    name: '',
    industry: 'ETF',
    price: 25,
    priceDate: '',
    stock: null,
    etf: {
      asOf: '',
      historyYears: 5,
      returns: { y1: 10, y3: 12, y5: 10 },
      volatility: 15,
      maxDrawdown: -20,
      yieldTtm: 6,
      distributions12m: 4,
      distributionYears: 6,
      avgTradeValue: 10,
      vs0050: { excess3y: -2, correlation: 0.8, beta: 0.6 },
      ...o,
    },
  })

  it('rates return against 0050, drawdown against the policy, liquidity and payout', () => {
    expect(tones(etf())).toEqual({ return: 'neutral', risk: 'good', liquidity: 'good', dividend: 'good' })
    expect(tones(etf({ vs0050: { excess3y: -8, correlation: 0.8, beta: 0.6 }, maxDrawdown: -40, avgTradeValue: 0.1 }))).toMatchObject({
      return: 'warn',
      risk: 'warn',
      liquidity: 'warn',
    })
  })
})
