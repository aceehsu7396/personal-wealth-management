import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../storage/appStore'
import { fetchLatestTwseClose, todayIsoDate } from './twse'
import { fetchTwseValuations, type TwseValuation } from './twseValuation'
import { followedTwseTickers, planPriceUpdates } from './priceSync'
import { fetchFinMindClose, fetchUsdTwd, fundQuote, priceSourceOf, SOURCE_LABELS, type PriceSource, type Quote } from './latestPrices'
import { fetchFundNavs } from './fundNav'

type Status = 'idle' | 'loading' | 'done' | 'error'

export interface RefreshSummary {
  updated: Partial<Record<PriceSource, number>>
  // Holdings that could not be updated, with the reason.
  skipped: { ticker: string; name: string; reason: string }[]
  fx: Quote | null
}

// Refreshes every holding's price once per day (on first visit) from free
// sources: TWSE for listed stocks/ETFs (plus valuations for research cards),
// FinMind for OTC and US stocks and USD/TWD, and the daily fund NAV
// snapshot for funds.
export function usePriceAutoRefresh() {
  const snapshot = useAppStore((s) => s.marketSnapshot)
  const setMarketSnapshot = useAppStore((s) => s.setMarketSnapshot)
  const updateHolding = useAppStore((s) => s.updateHolding)
  const setThesisPrices = useAppStore((s) => s.setThesisPrices)
  const setPortfolioMeta = useAppStore((s) => s.setPortfolioMeta)
  const [summary, setSummary] = useState<RefreshSummary | null>(null)
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { holdings, stockTheses } = useAppStore.getState()
    const tickers = followedTwseTickers(holdings, stockTheses)
    setStatus('loading')
    try {
      const valuations: Record<string, TwseValuation> = {}
      if (tickers.length > 0) {
        const table = await fetchTwseValuations()
        for (const ticker of tickers) {
          if (table?.valuations[ticker]) valuations[ticker] = table.valuations[ticker]
        }
        // ETFs are not in the valuation table; fall back to their daily close.
        const missing = tickers.filter((t) => !valuations[t])
        const closes = await Promise.allSettled(missing.map((t) => fetchLatestTwseClose(t)))
        closes.forEach((r, i) => {
          if (r.status !== 'fulfilled' || !r.value) return
          valuations[missing[i]] = {
            ticker: missing[i],
            name: '',
            close: r.value.close,
            dividendYield: null,
            pe: null,
            pb: null,
            period: '',
            date: r.value.date,
          }
        })
      }
      setMarketSnapshot({ fetchedOn: todayIsoDate(), valuations })

      const plan = planPriceUpdates(holdings, stockTheses, valuations)
      for (const u of plan.holdings) updateHolding(u.id, { currentPrice: u.price, priceUpdatedAt: u.date })
      setThesisPrices(plan.thesisPrices)

      const today = todayIsoDate()
      const result: RefreshSummary = { updated: {}, skipped: [], fx: null }
      const count = (source: PriceSource) => (result.updated[source] = (result.updated[source] ?? 0) + 1)
      const skip = (h: { ticker: string; name: string }, reason: string) => result.skipped.push({ ticker: h.ticker, name: h.name, reason })
      const apply = (id: string, current: number, q: Quote) => {
        if (q.price !== current) updateHolding(id, { currentPrice: q.price, priceUpdatedAt: q.date })
        else updateHolding(id, { priceUpdatedAt: q.date })
      }
      const funds = holdings.some((h) => h.kind === 'fund' && h.shares > 0) ? await fetchFundNavs() : null
      for (const h of holdings) {
        if (h.shares <= 0) continue
        const source = priceSourceOf(h)
        try {
          if (source === 'twse') {
            if (valuations[h.ticker]?.close != null) {
              count('twse')
              continue
            }
            // Not on TWSE: an OTC (TPEx) stock, which FinMind also covers.
            const q = await fetchFinMindClose(h.ticker.trim().toUpperCase(), 'TW', today)
            if (q) {
              apply(h.id, h.currentPrice, q)
              count('finmind_tw')
            } else skip(h, '證交所與 FinMind 都查不到這個代號')
          } else if (source === 'finmind_us') {
            const q = await fetchFinMindClose(h.ticker.trim().toUpperCase(), 'US', today)
            if (q) {
              apply(h.id, h.currentPrice, q)
              count('finmind_us')
            } else skip(h, 'FinMind 查不到這個美股代號')
          } else if (source === 'fund') {
            if (!funds) {
              skip(h, '今天的基金淨值資料還沒準備好')
              continue
            }
            const q = fundQuote(h, funds)
            if ('skip' in q) skip(h, q.skip)
            else {
              apply(h.id, h.currentPrice, q)
              count('fund')
            }
          }
        } catch (error) {
          skip(h, error instanceof Error ? error.message : '讀取失敗')
        }
      }
      if (holdings.some((h) => h.currency === 'USD' && h.shares > 0)) {
        try {
          result.fx = await fetchUsdTwd(today)
          if (result.fx) setPortfolioMeta({ fxUsdTwd: result.fx.price })
        } catch {
          // Keep the previous rate.
        }
      }
      setSummary(result)

      const parts = (Object.entries(result.updated) as [PriceSource, number][]).map(([s, n]) => `${SOURCE_LABELS[s]} ${n} 檔`)
      setMessage(
        parts.length === 0 && result.skipped.length === 0
          ? '目前沒有需要更新價格的持股。'
          : `已更新${parts.length ? `：${parts.join('、')}` : ' 0 檔'}${result.fx ? `；美元匯率 ${result.fx.price}（${result.fx.date}）` : ''}${
              result.skipped.length ? `；${result.skipped.length} 檔無法自動更新` : ''
            }。`,
      )
      setStatus('done')
    } catch (error) {
      console.warn('[usePriceAutoRefresh] 更新證交所資料失敗', error)
      setMessage('更新證交所資料失敗，稍後再試。')
      setStatus('error')
    }
  }, [setMarketSnapshot, updateHolding, setThesisPrices, setPortfolioMeta])

  // Refresh on the first visit of the day, and again when a newly followed
  // ticker has no data yet (tried once per set of missing tickers).
  const attemptedMissing = useRef<string | null>(null)
  const missingKey = followedTwseTickers(holdings, theses)
    .filter((t) => !snapshot.valuations[t])
    .sort()
    .join(',')
  useEffect(() => {
    const stale = snapshot.fetchedOn !== todayIsoDate()
    const newTickers = missingKey !== '' && attemptedMissing.current !== missingKey
    if (!stale && !newTickers) return
    attemptedMissing.current = missingKey
    void refresh()
  }, [refresh, snapshot.fetchedOn, missingKey])

  return { snapshot, status, message, summary, refresh }
}
