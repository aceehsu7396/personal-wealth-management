import { useEffect } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { fetchRecentTaiexAndTw0050, todayIsoDate } from '../lib/market/twse'
import { DailyMarketPanel } from '../components/market/DailyMarketPanel'
import { MacroPanel } from '../components/MacroPanel'

export function MarketPage() {
  const mergeMarketPriceHistory = useAppStore((s) => s.mergeMarketPriceHistory)

  // TWSE month-end closes still back the 富邦 forecast tracking below.
  useEffect(() => {
    if (useAppStore.getState().marketPriceHistory.lastFetchedDate === todayIsoDate()) return
    fetchRecentTaiexAndTw0050()
      .then(({ taiex, tw0050 }) => mergeMarketPriceHistory(taiex, tw0050, todayIsoDate()))
      .catch((error) => console.warn('[MarketPage] 更新 TWSE 收盤價失敗', error))
  }, [mergeMarketPriceHistory])

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">市場</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        每天看大盤走勢，每月做一次總經三支柱檢視：景氣體制、流動性、情緒溫度。兩者都只調整比例與新建倉，不決定個股進出（行動路線第三階段）。
      </p>

      <DailyMarketPanel />

      <MacroPanel />
    </div>
  )
}
