import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../storage/appStore'
import { fetchLatestTwseClose, todayIsoDate } from './twse'
import { fetchTwseValuations, type TwseValuation } from './twseValuation'
import { followedTwseTickers, planPriceUpdates } from './priceSync'

type Status = 'idle' | 'loading' | 'done' | 'error'

// Refreshes TWSE prices and valuations for followed tickers once per day (on
// first visit) and applies the new prices to holdings and research cards.
export function useTwseAutoRefresh() {
  const snapshot = useAppStore((s) => s.marketSnapshot)
  const setMarketSnapshot = useAppStore((s) => s.setMarketSnapshot)
  const updateHolding = useAppStore((s) => s.updateHolding)
  const setThesisPrices = useAppStore((s) => s.setThesisPrices)
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

      const found = Object.keys(valuations).length
      setMessage(
        tickers.length === 0
          ? '目前沒有追蹤中的上市台股。'
          : `已更新 ${found}/${tickers.length} 檔上市台股（上櫃股票與美股請手動輸入）。`,
      )
      setStatus('done')
    } catch (error) {
      console.warn('[useTwseAutoRefresh] 更新證交所資料失敗', error)
      setMessage('更新證交所資料失敗，稍後再試。')
      setStatus('error')
    }
  }, [setMarketSnapshot, updateHolding, setThesisPrices])

  useEffect(() => {
    if (useAppStore.getState().marketSnapshot.fetchedOn === todayIsoDate()) return
    void refresh()
  }, [refresh])

  return { snapshot, status, message, refresh }
}
