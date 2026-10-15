import { describe, expect, it } from 'vitest'
import { applyScreen, PRESET_SCREENS, type Screen } from './screens'
import { priceReturn, type StockRow } from './stockData'

function row(code: string, o: Partial<StockRow> = {}): StockRow {
  return {
    code,
    name: code,
    industry: '半導體業',
    isEtf: false,
    close: 100,
    pe: 20,
    dividendYield: 2,
    pb: 2,
    marketCap: 1000,
    tradeValue: 1,
    revenueYoy: 5,
    revenueYtdYoy: 5,
    revenueMonth: '2026-09',
    ret1m: 0.01,
    ret3m: 0.02,
    ret6m: 0.05,
    ret12m: 0.1,
    ...o,
  }
}

const preset = (id: string) => PRESET_SCREENS.find((p) => p.id === id)!.screen

describe('applyScreen', () => {
  const rows = [
    row('cheap', { pe: 10, pb: 1.2, dividendYield: 6 }),
    row('cheap-illiquid', { pe: 9, pb: 1, dividendYield: 7, tradeValue: 0.1 }),
    row('pricey'),
    row('no-pe', { pe: null, pb: 1, dividendYield: 8 }),
    row('etf', { isEtf: true, industry: 'ETF', pe: null, ret6m: 0.3 }),
  ]

  it('applies the value preset with its liquidity floor', () => {
    expect(applyScreen(rows, preset('value')).map((r) => r.code)).toEqual(['cheap'])
  })

  it('treats returns as percentages in filters', () => {
    const screen: Screen = { filters: [{ field: 'ret6m', min: 20 }], kind: 'all', industry: null, sortBy: 'ret6m', sortDesc: true }
    expect(applyScreen(rows, screen).map((r) => r.code)).toEqual(['etf'])
  })

  it('keeps the top share of a sorted universe', () => {
    const universe = Array.from({ length: 50 }, (_, i) => row(`s${i}`, { ret12m: i / 100 }))
    const top = applyScreen(universe, preset('momentum'))
    expect(top).toHaveLength(5)
    expect(top[0].code).toBe('s49')
  })

  it('filters by kind and industry', () => {
    expect(applyScreen(rows, preset('etf-momentum')).map((r) => r.code)).toEqual(['etf'])
    const screen: Screen = { filters: [], kind: 'all', industry: '水泥工業', sortBy: 'pe', sortDesc: false }
    expect(applyScreen(rows, screen)).toEqual([])
  })

  it('caps the large-cap list', () => {
    const universe = Array.from({ length: 80 }, (_, i) => row(`s${i}`, { marketCap: i }))
    expect(applyScreen(universe, preset('large'))).toHaveLength(50)
  })
})

describe('priceReturn', () => {
  it('ignores ratios that look like splits', () => {
    expect(priceReturn(110, 100)).toBeCloseTo(0.1)
    expect(priceReturn(50, 200)).toBeNull()
    expect(priceReturn(null, 100)).toBeNull()
  })
})
