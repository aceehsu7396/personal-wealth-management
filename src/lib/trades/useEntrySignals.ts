import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../storage/appStore'
import { parseSymbol } from '../backtest/templates'
import { todayIsoDate } from '../market/twse'
import { yearBars } from '../useHoldingReturns'
import { ENTRY_RULES, entrySignals, type EntrySignal } from './entrySignals'

export interface WatchedSignal {
  ticker: string
  market: 'TW' | 'US'
  name: string
  thesisId?: string
  strategyId?: string
  signals: EntrySignal[]
}

// Entry conditions for the watchlist, investable research cards and live
// strategy cards, at most ENTRY_RULES.maxSymbols symbols, read one at a
// time through the shared one-day cache.
export function useEntrySignals(): { items: WatchedSignal[]; loading: boolean } {
  const watchlist = useAppStore((s) => s.watchlist)
  const theses = useAppStore((s) => s.stockTheses)
  const strategies = useAppStore((s) => s.tradingStrategies)
  const targets = useMemo(() => {
    const out = new Map<string, Omit<WatchedSignal, 'signals'>>()
    const add = (symbol: string, name: string, extra: Partial<WatchedSignal> = {}) => {
      const { market, code } = parseSymbol(symbol.includes(':') ? symbol : `TW:${symbol}`)
      if (!code || (market !== 'TW' && market !== 'US')) return
      const key = `${market}|${code}`
      out.set(key, { ...out.get(key), ticker: code, market, name: out.get(key)?.name || name, ...extra })
    }
    for (const t of theses) if (t.verdict === 'invest' && t.status !== 'exited') add(`${t.market}:${t.ticker}`, t.name, { thesisId: t.id })
    for (const s of strategies) if (s.status === 'live') for (const sym of s.symbols) add(sym, '', { strategyId: s.id })
    for (const w of watchlist) add(w.symbol, w.name)
    return [...out.values()].slice(0, ENTRY_RULES.maxSymbols)
  }, [watchlist, theses, strategies])
  const key = targets.map((t) => `${t.market}|${t.ticker}`).join(',')
  const [signals, setSignals] = useState<Record<string, EntrySignal[]>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!key) return
    let alive = true
    setLoading(true)
    const today = todayIsoDate()
    void (async () => {
      const out: Record<string, EntrySignal[]> = {}
      for (const k of key.split(',')) {
        const [market, ticker] = k.split('|') as ['TW' | 'US', string]
        const bars = await yearBars(ticker, market, today)
        out[k] = bars ? entrySignals(bars) : []
      }
      if (alive) {
        setSignals(out)
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [key])

  return { items: targets.map((t) => ({ ...t, signals: signals[`${t.market}|${t.ticker}`] ?? [] })), loading }
}
