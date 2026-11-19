import { useEffect, useState } from 'react'
import type { StrategyComparison } from '../../lib/storage/schema'
import { useAppStore } from '../../lib/storage/appStore'
import { fetchStockData, type StockRow } from '../../lib/screener/stockData'
import { INTERPRET_RULES } from '../../lib/backtest/interpret'
import { downloadSeconds, downloadText, peerBasket, watchBasket } from '../../lib/backtest/basket'
import { isoDaysAgo, loadSeries } from '../../lib/market/priceHistory'
import { formatSymbol } from '../../lib/backtest/templates'
import { secondaryButton } from '../ui'

const LONG_YEARS = 10

interface Props {
  comparison: StrategyComparison
  today: string
  busy: boolean
  onRun: (over: { codes?: string[]; start?: string }) => void
}

// Shown when a signal row has fewer than 20 trades (handbook 10 §6.7):
// widen the sample with similar stocks, or lengthen it, instead of
// shortening the rules to trade more often.
export function FewTradesPanel({ comparison: c, today, busy, onRun }: Props) {
  const watchlist = useAppStore((s) => s.watchlist)
  const [stocks, setStocks] = useState<StockRow[] | null>(null)
  const symbols = c.symbol.split(',')
  const few = c.rows.filter((r) => r.entry.role === 'signal' && r.stats && r.stats.full.trades < INTERPRET_RULES.minTrades)
  // Peers only for one Taiwan stock.
  const lookUp = few.length > 0 && /^TW:[^,]+$/.test(c.symbol)

  useEffect(() => {
    if (!lookUp) return
    let cancelled = false
    void fetchStockData().then((d) => {
      if (!cancelled) setStocks(d?.stocks ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [lookUp])

  if (few.length === 0) return null
  const cached = (s: string) => loadSeries(s)?.months ?? []
  const longStart = isoDaysAgo(today, LONG_YEARS)
  const peers = symbols.length === 1 && stocks ? peerBasket(symbols[0], stocks) : null
  const watched = watchBasket(symbols, watchlist.map((w) => w.symbol))
  const options = [
    ...(peers ? [{ key: 'peers', label: `加入${peers.label}一起驗證`, codes: peers.symbols, start: c.start }] : []),
    ...(watched ? [{ key: 'watch', label: '加入觀察名單一起驗證', codes: watched, start: c.start }] : []),
    ...(c.start > longStart ? [{ key: 'long', label: `延長到 ${LONG_YEARS} 年再跑`, codes: symbols, start: longStart }] : []),
  ]
  const lowest = Math.min(...few.map((r) => r.stats!.full.trades))

  return (
    <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-900/20">
      <p className="font-medium text-amber-900 dark:text-amber-200">
        交易筆數不足：{few.length} 個範本少於 {INTERPRET_RULES.minTrades} 筆（最少 {lowest} 筆）
      </p>
      <p className="mt-1 text-gray-700 dark:text-gray-300">趨勢型範本每檔一年只交易 1–3 次，5 年、1 檔本來就不夠。</p>
      <p className="mt-1 text-gray-700 dark:text-gray-300">先加廣度（同類標的一起回測，看合計筆數與各檔是否都通過）或長度（10 年），不要靠縮短參數換筆數：交易變多，成本和雜訊也變多。</p>
      {options.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {options.map((o) => (
            <li key={o.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button type="button" disabled={busy} onClick={() => onRun({ codes: o.codes, start: o.start })} className={secondaryButton}>
                {o.label}
              </button>
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {o.codes.map(formatSymbol).join('、')}・{o.start} 起・{downloadText(downloadSeconds(o.codes, o.start, today, cached))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">在上方代號欄加入同類標的（逗號分隔）再跑一次，合計筆數達 {INTERPRET_RULES.minTrades} 筆再判斷。</p>
      )}
    </div>
  )
}
