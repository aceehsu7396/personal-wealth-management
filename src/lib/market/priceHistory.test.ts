import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adjustBars,
  detectSplits,
  fetchTwseSeries,
  loadSeries,
  monthsInRange,
  parseCsvBars,
  parseExRights,
  parseStockDay,
  rocChineseDate,
  seriesForBacktest,
  type Bar,
} from './priceHistory'

function bar(date: string, close: number, open = close): Bar {
  return { date, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 0 }
}

describe('parsing', () => {
  it('reads STOCK_DAY rows and skips days without trades', () => {
    const rows = parseStockDay({
      stat: 'OK',
      data: [
        ['115/09/01', '111,066,980', '1', '106.50', '108.70', '106.50', '108.45', '+2.20', '1', ''],
        ['115/09/02', '0', '0', '--', '--', '--', '--', '', '0', ''],
      ],
    })
    expect(rows).toEqual([{ date: '2026-09-01', open: 106.5, high: 108.7, low: 106.5, close: 108.45, volume: 111066980 }])
  })

  it('reads ex-rights events as reference ÷ prior close', () => {
    const events = parseExRights({
      stat: 'OK',
      data: [['114年07月21日', '0050', '元大台灣50', '51.45', '51.09', '0.36', '息']],
    })
    expect(events['0050'][0].date).toBe('2025-07-21')
    expect(events['0050'][0].factor).toBeCloseTo(51.09 / 51.45)
    expect(rocChineseDate('114年01月17日')).toBe('2025-01-17')
  })

  it('reads Yahoo CSV and applies Adj Close to OHLC', () => {
    const csv = 'Date,Open,High,Low,Close,Adj Close,Volume\n2024-01-02,100,102,99,101,50.5,10\n2024-01-03,null,null,null,null,null,0\n'
    const rows = parseCsvBars(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ open: 50, high: 51, close: 50.5 })
    expect(() => parseCsvBars('a,b\n1,2')).toThrow('Date')
  })
})

describe('adjustment', () => {
  const raw = [bar('2025-06-17', 200), bar('2025-06-18', 50.5, 50), bar('2025-07-20', 51.45), bar('2025-07-21', 51.09)]

  it('detects a 1→4 split from a gap far beyond the daily limit', () => {
    expect(detectSplits(raw)).toEqual([{ date: '2025-06-18', factor: 0.25 }])
    expect(detectSplits([bar('2025-01-01', 100), bar('2025-01-02', 91)])).toEqual([])
  })

  it('back-adjusts bars before each event', () => {
    const adjusted = adjustBars(raw, [{ date: '2025-06-18', factor: 0.25 }, { date: '2025-07-21', factor: 51.09 / 51.45 }])
    expect(adjusted[3].close).toBe(51.09)
    expect(adjusted[2].close).toBeCloseTo(51.09)
    expect(adjusted[0].close).toBeCloseTo(200 * 0.25 * (51.09 / 51.45))
  })

  it('combines TWSE dividends with detected splits', () => {
    const { bars } = seriesForBacktest({
      symbol: 'TW:0050',
      source: 'twse',
      bars: raw,
      months: [],
      events: [{ date: '2025-07-21', factor: 51.09 / 51.45 }],
      adjusted: false,
      updatedAt: '',
    })
    // The split no longer shows as a 75% drop, and the dividend gap is gone.
    expect(bars[1].open / bars[0].close).toBeCloseTo(1, 6)
    expect(bars[2].close).toBeCloseTo(bars[3].close)
  })
})

describe('fetchTwseSeries', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    })
  })

  it('downloads months and ex-rights once, then only refreshes the current month', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('TWT49U')) return { stat: 'OK', data: [['115年08月10日', '0050', 'x', '100', '99', '1', '息']] }
      const date = new URL(url).searchParams.get('date')!
      const roc = `${Number(date.slice(0, 4)) - 1911}/${date.slice(4, 6)}/05`
      return { stat: 'OK', data: [[roc, '1', '1', '10', '11', '9', '10', '0', '1', '']] }
    })
    const deps = { fetchJson, sleep: async () => {} }
    const progress: number[] = []
    const first = await fetchTwseSeries('0050', '2026-08-01', '2026-10-12', (p) => progress.push(p.done), deps)
    expect(fetchJson).toHaveBeenCalledTimes(4) // Aug, Sep, Oct + one ex-rights year
    expect(progress).toEqual([1, 2, 3, 4])
    expect(first.bars.map((b) => b.date)).toEqual(['2026-08-05', '2026-09-05', '2026-10-05'])
    expect(first.events).toEqual([{ date: '2026-08-10', factor: 0.99 }])
    expect(loadSeries('TW:0050')?.bars).toHaveLength(3)

    fetchJson.mockClear()
    await fetchTwseSeries('0050', '2026-08-01', '2026-10-12', undefined, deps)
    expect(fetchJson.mock.calls.map(([u]) => (u.includes('TWT49U') ? 'ex' : new URL(u).searchParams.get('date')))).toEqual([
      '20261001',
      'ex',
    ])
  })

  it('lists the months of a range', () => {
    expect(monthsInRange('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
})
