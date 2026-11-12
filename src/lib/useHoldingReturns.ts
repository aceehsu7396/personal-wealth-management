import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from './storage/appStore'
import { fetchDataset } from './research/finmind'
import { useDailyMarket } from './market/useDailyMarket'
import { todayIsoDate } from './market/twse'
import { annualVol, onCalendar, returnsByDate, TRADING_DAYS } from './calculations/riskMetrics'
import { exposureKind } from './calculations/stressTest'
import type { Holding } from './storage/schema'

export type ReturnSource = 'history' | 'proxy' | 'none'

export interface HoldingReturns {
  holding: Holding
  returns: number[]
  source: ReturnSource
}

// A year before today: one cache key per day, shared with the plan editor.
export const historyStart = (today: string) => {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() - 1)
  return d.toISOString().slice(0, 10)
}

// After a failed read (usually the free quota), skip FinMind for a while
// instead of failing once per holding.
const BACKOFF_MS = 10 * 60 * 1000
let blockedUntil = 0

// Closes for one ticker over the past year; null when FinMind cannot help.
export async function yearCloses(ticker: string, market: 'TW' | 'US', today: string): Promise<{ date: string; close: number }[] | null> {
  if (Date.now() < blockedUntil) return null
  try {
    const rows = await fetchDataset<{ date: string; close?: number; Close?: number }>(market === 'TW' ? 'TaiwanStockPrice' : 'USStockPrice', ticker, historyStart(today))
    const out = rows.map((r) => ({ date: r.date.slice(0, 10), close: r.close ?? r.Close ?? 0 })).filter((r) => r.close > 0)
    return out.length >= 60 ? out : null
  } catch {
    blockedUntil = Date.now() + BACKOFF_MS
    return null
  }
}

const listedTw = (h: Holding) => h.kind !== 'fund' && h.currency === 'TWD'
const listedUs = (h: Holding) => h.kind !== 'fund' && h.currency === 'USD'

// Daily returns of every holding on the TAIEX calendar of the past year.
// A holding without history stands in with its index (TAIEX or S&P 500);
// cash-like holdings count as flat. FinMind is read one ticker at a time,
// with its one-day cache, to stay within the free quota.
export function useHoldingReturns(): { calendar: string[]; market: number[]; spx: number[]; rows: HoldingReturns[]; loading: boolean } {
  const holdings = useAppStore((s) => s.holdings)
  const { data } = useDailyMarket()
  const [closes, setCloses] = useState<Record<string, { date: string; close: number }[] | null>>({})
  const [loading, setLoading] = useState(false)
  const wanted = holdings.filter((h) => listedTw(h) || listedUs(h)).map((h) => `${h.currency === 'USD' ? 'US' : 'TW'}|${h.ticker}`)
  const key = [...new Set(wanted)].sort().join(',')

  useEffect(() => {
    if (!key) return
    let alive = true
    setLoading(true)
    const today = todayIsoDate()
    void (async () => {
      const out: Record<string, { date: string; close: number }[] | null> = {}
      for (const k of key.split(',')) {
        const [market, ticker] = k.split('|') as ['TW' | 'US', string]
        out[k] = await yearCloses(ticker, market, today)
      }
      if (alive) {
        setCloses(out)
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [key])

  return useMemo(() => {
    const taiex = (data?.series.TAIEX ?? []).slice(-(TRADING_DAYS + 1))
    const calendar = taiex.slice(1).map((p) => p.date)
    const market = onCalendar(calendar, returnsByDate(taiex))
    const spx = onCalendar(calendar, returnsByDate((data?.series.GSPC ?? []).slice(-(TRADING_DAYS + 30))))
    const rows = holdings.map((holding): HoldingReturns => {
      const k = `${holding.currency === 'USD' ? 'US' : 'TW'}|${holding.ticker}`
      const own = closes[k]
      if (own) return { holding, returns: onCalendar(calendar, returnsByDate(own)), source: 'history' }
      const kind = exposureKind(holding)
      if (kind === 'cash' || kind === 'bond') return { holding, returns: calendar.map(() => 0), source: 'none' }
      return { holding, returns: kind === 'us_equity' ? spx : market, source: 'proxy' }
    })
    return { calendar, market, spx, rows, loading }
  }, [data, holdings, closes, loading])
}

// Annualised volatility in %, from a year of closes.
export const annualVolPercent = (closes: { date: string; close: number }[]) => annualVol([...returnsByDate(closes).values()]) * 100

// One ticker's annualised volatility for the plan editor; null until known.
export function useAnnualVol(ticker: string, market: 'TW' | 'US'): number | null {
  const [vol, setVol] = useState<{ key: string; value: number | null } | null>(null)
  const key = `${market}|${ticker}`
  useEffect(() => {
    if (!ticker) return
    let alive = true
    void yearCloses(ticker, market, todayIsoDate()).then((c) => alive && setVol({ key, value: c ? annualVolPercent(c) : null }))
    return () => {
      alive = false
    }
  }, [key, ticker, market])
  return vol?.key === key ? vol.value : null
}
