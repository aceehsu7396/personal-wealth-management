import { useEffect, useState } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { fetchRecentTaiexAndTw0050, todayIsoDate } from '../lib/market/twse'
import { MarketPriceChart } from '../components/charts/MarketPriceChart'
import { MacroPanel } from '../components/MacroPanel'

export function MarketPage() {
  const marketPriceHistory = useAppStore((s) => s.marketPriceHistory)
  const mergeMarketPriceHistory = useAppStore((s) => s.mergeMarketPriceHistory)
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    if (useAppStore.getState().marketPriceHistory.lastFetchedDate === todayIsoDate()) return
    setFetchState('loading')
    fetchRecentTaiexAndTw0050()
      .then(({ taiex, tw0050 }) => {
        mergeMarketPriceHistory(taiex, tw0050, todayIsoDate())
        setFetchState('idle')
      })
      .catch((error) => {
        console.warn('[MarketPage] 更新 TWSE 收盤價失敗', error)
        setFetchState('error')
      })
  }, [mergeMarketPriceHistory])

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">市場</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        每月一次的總經三支柱檢視：景氣體制、流動性、情緒溫度。總經只用來微調股債比例，不決定個股進出（行動路線第三階段）。
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        {fetchState === 'loading' && <p className="mb-3 text-xs text-gray-400">正在向證交所更新今日收盤價…</p>}
        {fetchState === 'error' && <p className="mb-3 text-xs text-red-500">更新收盤價失敗，顯示上次快取的資料。</p>}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <MarketPriceChart
            data={marketPriceHistory.taiex}
            label="大盤（發行量加權股價指數）"
            color="#4f46e5"
            gradientId="taiexFill"
          />
          <MarketPriceChart data={marketPriceHistory.tw0050} label="0050" color="#f97316" gradientId="tw0050Fill" />
        </div>
      </div>

      <MacroPanel />
    </div>
  )
}
