import { useEffect } from 'react'
import { useAppStore } from '../lib/storage/appStore'
import { fetchRecentTaiexAndTw0050, todayIsoDate } from '../lib/market/twse'
import { DailyMarketPanel } from '../components/market/DailyMarketPanel'
import { MacroPanel } from '../components/MacroPanel'
import { RegimeCard } from '../components/market/RegimeCard'
import { EventCalendarCard } from '../components/market/EventCalendarCard'
import { PageHeader } from '../components/ui'

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
      <PageHeader title="市場" summary="現在是什麼局勢、這個局勢下怎麼交易；下方是每日大盤與每月的總經三支柱檢視。局勢只調整部位與進場方式，不決定個股進出。" />

      <div className="mt-6">
        <RegimeCard />
      </div>

      <div className="mt-6">
        <EventCalendarCard />
      </div>

      <DailyMarketPanel />

      <MacroPanel />
    </div>
  )
}
