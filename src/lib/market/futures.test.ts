import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyFuturesCheck,
  barsFromRows,
  catchUpFutures,
  expectedSessions,
  futuresReliability,
  nightLine,
  nightReading,
  nightSpan,
  type FuturesBar,
} from './futures'
import type { Fetcher } from '../research/finmind'

const row = (date: string, session: string, contract: string, close: number, volume: number, spread = 0) => ({
  date,
  contract_date: contract,
  open: close,
  max: close,
  min: close,
  close,
  spread,
  volume,
  trading_session: session,
})

const bar = (date: string, session: FuturesBar['session'], close: number, change = 0): FuturesBar => ({
  date,
  session,
  contract: '202611',
  open: close,
  high: close,
  low: close,
  close,
  change,
  volume: 1,
})

describe('futures rows', () => {
  it('keeps the most traded outright month per session, night before day', () => {
    const bars = barsFromRows([
      row('2026-11-05', 'position', '202611', 41915, 98430, -1288),
      row('2026-11-05', 'position', '202612', 41983, 591),
      row('2026-11-05', 'position', '202611/202612', 69, 130000),
      row('2026-11-05', 'after_market', '202611', 43404, 66939, 201),
      row('2026-11-06', 'after_market', '202612', 0, 5),
    ])
    expect(bars.map((b) => [b.date, b.session, b.contract, b.close])).toEqual([
      ['2026-11-05', 'night', '202611', 43404],
      ['2026-11-05', 'day', '202611', 41915],
    ])
  })
})

describe('session times', () => {
  it('dates a night by the trading day it belongs to', () => {
    // Friday 13:00 Taipei: the night that ended at 05:00 is dated Friday; the day session is not out.
    expect(expectedSessions(new Date('2026-11-06T05:00:00Z'))).toEqual({ night: '2026-11-06', day: '2026-11-05' })
    // Friday 15:00: the day session is out.
    expect(expectedSessions(new Date('2026-11-06T07:00:00Z')).day).toBe('2026-11-06')
    // Friday 04:00: still Thursday's night.
    expect(expectedSessions(new Date('2026-11-05T20:00:00Z')).night).toBe('2026-11-05')
    // Saturday 07:00 and Sunday: Friday's night is dated Monday.
    expect(expectedSessions(new Date('2026-11-06T23:00:00Z')).night).toBe('2026-11-09')
    expect(expectedSessions(new Date('2026-11-08T04:00:00Z'))).toEqual({ night: '2026-11-09', day: '2026-11-06' })
  })

  it('spans a night from the previous day session', () => {
    const bars = [bar('2026-11-06', 'day', 1), bar('2026-11-09', 'night', 1)]
    expect(nightSpan(bars, bars[1])).toBe('11/6 15:00–11/7 05:00')
  })
})

describe('night reading', () => {
  it('reads the change from settlement and the gap to the index', () => {
    const bars = [bar('2026-11-05', 'day', 41915), bar('2026-11-06', 'night', 38936, -2946)]
    const r = nightReading(bars, [{ date: '2026-11-05', close: 41900 }, { date: '2026-11-06', close: 39000 }])!
    expect(r.changePct).toBeCloseTo(-7.03, 2)
    expect(r.vsSpot).toBe(38936 - 41900)
    expect(nightLine(r)).toBe('台指期夜盤（11/5 15:00–11/6 05:00）收 38,936，較日盤結算 −2,946（−7.03%），低於加權指數（11-05）收盤 2,964 點。')
  })

  it('corrects a session the official close disagrees with', () => {
    const bars = [bar('2026-11-06', 'night', 100, -5)]
    const check = { source: '期交所', date: '2026-11-06', session: 'night' as const, official: 110, primary: 100 }
    expect(applyFuturesCheck(bars, check)[0]).toMatchObject({ close: 110, change: 5 })
    expect(futuresReliability(bars, check, { night: '2026-11-06', day: '2026-11-05' }).status).toBe('mismatch')
    expect(futuresReliability(bars, { ...check, primary: 110.2 }, { night: '2026-11-06', day: '2026-11-05' }).status).toBe('verified')
    expect(futuresReliability(bars, null, { night: '2026-11-10', day: '2026-11-09' }).status).toBe('stale')
    const later = [...bars, bar('2026-11-06', 'day', 120)]
    expect(futuresReliability(later, check, { night: '2026-11-06', day: '2026-11-06' }).status).toBe('unverified')
  })
})

describe('catch-up', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      get length() {
        return store.size
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  it('fetches only when a newer session should exist, then caches it', async () => {
    const urls: string[] = []
    const fetcher: Fetcher = async (url) => {
      urls.push(url)
      const data = [row('2026-11-06', 'after_market', '202611', 38936, 9, -2946), row('2026-11-05', 'position', '202611', 41915, 9)]
      return { ok: true, status: 200, json: async () => ({ status: 200, data }) }
    }
    const expected = { night: '2026-11-06', day: '2026-11-05' }
    const known = [bar('2026-11-05', 'night', 43404), bar('2026-11-05', 'day', 41915)]
    const got = await catchUpFutures(known, expected, '2025-10-01', fetcher)
    expect(got.at(-1)).toMatchObject({ date: '2026-11-06', session: 'night', close: 38936 })
    expect(urls[0]).toContain('start_date=2026-10-29')
    await catchUpFutures(known, expected, '2025-10-01', fetcher)
    expect(urls).toHaveLength(1)
    await catchUpFutures(got, expected, '2025-10-01', fetcher)
    expect(urls).toHaveLength(1)
  })
})
