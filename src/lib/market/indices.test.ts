import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyCheck,
  expectedTradingDay,
  flowsFromRows,
  loadIndices,
  marginFromRows,
  pointsFromRows,
  reliabilityOf,
  weekdaysBetween,
  type IndexCheck,
  type IndicesData,
} from './indices'
import type { Fetcher } from '../research/finmind'

const check = (primary: number | null, official = 100, date = '2026-11-03'): IndexCheck => ({ source: '證交所', date, official, primary })

describe('trading days', () => {
  it('waits for each market to publish its close', () => {
    // 2026-11-04 (Wed) 13:00 in Taipei: today's Taiwan close is not out yet.
    expect(expectedTradingDay('TW', new Date('2026-11-04T05:00:00Z'))).toBe('2026-11-03')
    expect(expectedTradingDay('TW', new Date('2026-11-04T07:00:00Z'))).toBe('2026-11-04')
    // Same instant is 01:00 in New York: the latest US close is Tuesday's.
    expect(expectedTradingDay('US', new Date('2026-11-04T05:00:00Z'))).toBe('2026-11-03')
    // Saturday and Monday morning both point back to Friday.
    expect(expectedTradingDay('TW', new Date('2026-11-07T07:00:00Z'))).toBe('2026-11-06')
    expect(expectedTradingDay('TW', new Date('2026-11-09T01:00:00Z'))).toBe('2026-11-06')
  })

  it('counts weekdays only', () => {
    expect(weekdaysBetween('2026-11-06', '2026-11-09')).toBe(1)
    expect(weekdaysBetween('2026-11-03', '2026-11-03')).toBe(0)
  })
})

describe('reliability', () => {
  const pts = [{ date: '2026-11-03', close: 100.4 }]
  it('accepts a gap of 0.5% or less and flags a larger one', () => {
    expect(reliabilityOf(pts, check(100.4), '2026-11-03').status).toBe('verified')
    expect(reliabilityOf(pts, check(100.6), '2026-11-03').status).toBe('mismatch')
    expect(reliabilityOf(pts, undefined, '2026-11-03').status).toBe('unverified')
  })

  it('tolerates one missing weekday (a holiday) but not two', () => {
    expect(reliabilityOf(pts, check(100.4), '2026-11-04').status).toBe('verified')
    expect(reliabilityOf(pts, check(100.4), '2026-11-05').status).toBe('stale')
  })

  it('replaces a disagreeing close with the official one', () => {
    const series = [
      { date: '2026-11-02', close: 99 },
      { date: '2026-11-03', close: 100.6 },
    ]
    expect(applyCheck(series, check(100.6)).at(-1)!.close).toBe(100)
    expect(applyCheck(series, check(100.4, 100.4))).toBe(series)
    // The official close fills a day FinMind has not published yet.
    expect(applyCheck(series, check(null, 101, '2026-11-04')).at(-1)).toEqual({ date: '2026-11-04', close: 101 })
  })
})

describe('FinMind rows', () => {
  it('reads each dataset shape', () => {
    expect(pointsFromRows('USStockPrice', [{ date: '2026-11-03', Close: 7568.921 }])).toEqual([{ date: '2026-11-03', close: 7568.92 }])
    expect(pointsFromRows('TaiwanStockTotalReturnIndex', [{ date: '2026-11-03', price: 100144.27 }])[0].close).toBe(100144.27)
    expect(pointsFromRows('TaiwanStockPrice', [{ date: '2026-11-03', close: 0 }])).toEqual([])
  })

  it('nets institutional flows by group', () => {
    const flows = flowsFromRows([
      { date: '2026-11-03', name: 'Foreign_Investor', buy: 10, sell: 30 },
      { date: '2026-11-03', name: 'Dealer_self', buy: 5, sell: 1 },
      { date: '2026-11-03', name: 'Dealer_Hedging', buy: 2, sell: 4 },
      { date: '2026-11-03', name: 'total', buy: 99, sell: 1 },
    ])
    expect(flows).toEqual([{ date: '2026-11-03', foreign: -20, trust: 0, dealer: 2 }])
    expect(marginFromRows([{ date: '2026-11-03', name: 'MarginPurchase', TodayBalance: 9 }, { date: '2026-11-03', name: 'MarginPurchaseMoney', TodayBalance: 6e11 }])).toEqual([
      { date: '2026-11-03', balance: 6e11 },
    ])
  })
})

describe('loadIndices', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  const snapshot = (last: string): IndicesData => ({
    generatedAt: '',
    errors: [],
    series: { TAIEX: [{ date: last, close: 100 }] },
    checks: {},
    breadth: null,
    flows: [{ date: last, foreign: 1, trust: 0, dealer: 0 }],
    margin: [{ date: last, balance: 1 }],
  })

  function finmind(urls: string[]): Fetcher {
    return async (url) => {
      urls.push(url)
      const id = new URL(url).searchParams.get('data_id')
      const dataset = new URL(url).searchParams.get('dataset')
      const data = dataset === 'TaiwanStockPrice' && id === 'TAIEX' ? [{ date: '2026-11-04', close: 101 }] : []
      return { ok: true, status: 200, json: async () => ({ status: 200, data }) }
    }
  }

  it('tops up a snapshot older than the latest close', async () => {
    const urls: string[] = []
    const now = new Date('2026-11-04T07:00:00Z')
    const loaded = await loadIndices(snapshot('2026-11-03'), { now, fetcher: finmind(urls) })
    expect(loaded.series.TAIEX!.map((p) => p.date)).toEqual(['2026-11-03', '2026-11-04'])
    expect(urls.some((u) => u.includes('data_id=TAIEX') && u.includes('start_date=2026-10-27'))).toBe(true)

    // Reached the expected day, so a second load reads the cache.
    const again: string[] = []
    await loadIndices(snapshot('2026-11-03'), { now, fetcher: finmind(again) })
    expect(again.some((u) => u.includes('dataset=TaiwanStockPrice&data_id=TAIEX&'))).toBe(false)
  })

  it('does not fetch what the snapshot already has', async () => {
    const urls: string[] = []
    await loadIndices(snapshot('2026-11-04'), { now: new Date('2026-11-04T07:00:00Z'), fetcher: finmind(urls) })
    expect(urls.some((u) => u.includes('TaiwanStockTotalInstitutionalInvestors'))).toBe(false)
  })

  it('loads full history without a snapshot', async () => {
    const urls: string[] = []
    const loaded = await loadIndices(null, { now: new Date('2026-11-04T07:00:00Z'), fetcher: finmind(urls) })
    expect(urls.find((u) => u.includes('dataset=TaiwanStockPrice&data_id=TAIEX&'))).toContain('start_date=2022-11-04')
    expect(loaded.reliability.TAIEX!.status).toBe('unverified')
    expect(loaded.reliability.GSPC!.status).toBe('stale')
  })
})
