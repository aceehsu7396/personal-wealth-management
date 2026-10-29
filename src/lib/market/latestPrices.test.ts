import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findFund, fundCurrency, searchFunds, unpackFunds, type FundNav } from './fundNav'
import { fetchFinMindClose, fetchUsdTwd, fundQuote, priceSourceOf } from './latestPrices'

const funds: FundNav[] = unpackFunds({
  generatedAt: '',
  errors: [],
  funds: [
    ['A04008', '匯豐龍鳳基金-A類型', 298.45, '2026-10-28', '新台幣'],
    ['B16,009', '景順全歐洲小型企業基金A股 歐元', 41.13, '2026-10-28', '歐元'],
    ['B20,015', '安聯收益成長基金-AM穩定月收類股(美元)', 7.21, '2026-10-27', '美元'],
  ],
})

describe('fund NAV snapshot', () => {
  it('finds a fund by code (ignoring punctuation) or exact name', () => {
    expect(findFund({ ticker: 'b16009', name: '' }, funds)!.code).toBe('B16,009')
    expect(findFund({ ticker: '', name: '匯豐龍鳳基金 - A類型' }, funds)!.code).toBe('A04008')
    expect(findFund({ ticker: '', name: '匯豐龍鳳' }, funds)).toBeNull()
    expect(findFund({ ticker: 'X', name: '匯豐龍鳳基金-A類型' }, funds)!.code).toBe('A04008')
  })

  it('searches by every word of the query', () => {
    expect(searchFunds('安聯 收益', funds).map((f) => f.code)).toEqual(['B20,015'])
    expect(searchFunds('A04', funds).map((f) => f.code)).toEqual(['A04008'])
    expect(searchFunds('  ', funds)).toEqual([])
  })

  it('prices only funds in the holding currency', () => {
    expect(fundCurrency('美元')).toBe('USD')
    expect(fundQuote({ ticker: 'B20,015', name: '', currency: 'USD' }, funds)).toEqual({ price: 7.21, date: '2026-10-27' })
    expect(fundQuote({ ticker: 'B16009', name: '', currency: 'TWD' }, funds)).toMatchObject({ skip: expect.stringContaining('歐元') })
    expect(fundQuote({ ticker: 'ZZZ', name: '', currency: 'TWD' }, funds)).toMatchObject({ skip: expect.stringContaining('找不到') })
  })
})

describe('price sources', () => {
  it('routes each holding to a free source', () => {
    expect(priceSourceOf({ kind: 'security', ticker: '0050', currency: 'TWD' })).toBe('twse')
    expect(priceSourceOf({ kind: 'security', ticker: '6488', currency: 'TWD' })).toBe('twse')
    expect(priceSourceOf({ kind: 'security', ticker: 'voo', currency: 'USD' })).toBe('finmind_us')
    expect(priceSourceOf({ kind: 'security', ticker: 'BRK.B', currency: 'USD' })).toBe('finmind_us')
    expect(priceSourceOf({ kind: 'fund', ticker: 'A04008', currency: 'TWD' })).toBe('fund')
    expect(priceSourceOf({ kind: 'security', ticker: 'CASH', currency: 'TWD' })).toBe('manual')
  })
})

describe('FinMind quotes', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })
  const fetcher = (data: unknown[]) => vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => ({ status: 200, msg: 'success', data }) }))

  it('takes the latest close for TW and US codes', async () => {
    const tw = fetcher([{ date: '2026-10-27', close: 840 }, { date: '2026-10-28', close: 844 }])
    expect(await fetchFinMindClose('6488', 'TW', '2026-10-29', tw)).toEqual({ price: 844, date: '2026-10-28' })
    expect(tw.mock.calls[0][0]).toContain('dataset=TaiwanStockPrice')
    const us = fetcher([{ date: '2026-10-28', Close: 710.7 }])
    expect(await fetchFinMindClose('VOO', 'US', '2026-10-29', us)).toEqual({ price: 710.7, date: '2026-10-28' })
    expect(await fetchFinMindClose('NONE', 'US', '2026-10-29', fetcher([]))).toBeNull()
  })

  it('uses the mid of the spot USD/TWD rates', async () => {
    const fx = fetcher([{ date: '2026-10-28', spot_buy: 32.435, spot_sell: 32.535 }])
    expect(await fetchUsdTwd('2026-10-29', fx)).toEqual({ price: 32.485, date: '2026-10-28' })
  })
})
