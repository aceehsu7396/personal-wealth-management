import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../storage/appStore'
import { fetchDataset } from '../research/finmind'
import type { PriceRow } from '../research/etfProfile'
import type { Bar } from '../market/priceHistory'
import type { TradePlan } from '../storage/schema'
import { positionStatus, type PositionStatus } from './tradePlan'

export interface OpenPlanStatus {
  plan: TradePlan
  status: PositionStatus | null
  // Daily bars could not be read; only the holding's last price is used.
  degraded: boolean
}

const shiftDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Enough history before entry for the ATR and the trailing average.
function startFor(plan: TradePlan): string {
  const opened = (plan.openedAt ?? plan.createdAt).slice(0, 10)
  const lookback = Math.max(60, Math.round((plan.trailingParam && plan.trailing === 'moving_average' ? plan.trailingParam : 20) * 1.6))
  return shiftDays(opened, -lookback)
}

const toBars = (rows: PriceRow[]): Bar[] =>
  rows
    .filter((r) => r.close > 0)
    .map((r) => ({ date: r.date, open: r.open, high: r.max, low: r.min, close: r.close, volume: r.Trading_Volume ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))

// Status of every open trade plan (stop, R, targets, trailing stop) from
// daily bars. FinMind keeps a one-day cache, so the exit manager and the
// day's scan share one download.
export function useOpenPlanStatus(): { items: OpenPlanStatus[]; loading: boolean } {
  const plans = useAppStore((s) => s.tradePlans)
  const holdings = useAppStore((s) => s.holdings)
  const open = useMemo(() => plans.filter((p) => p.status === 'open'), [plans])
  const [bars, setBars] = useState<Record<string, Bar[] | null>>({})
  const [loading, setLoading] = useState(false)
  const wanted = open.filter((p) => p.market === 'TW').map((p) => `${p.ticker}|${startFor(p)}`)
  const key = [...new Set(wanted)].sort().join(',')

  useEffect(() => {
    if (!key) return
    let alive = true
    setLoading(true)
    void Promise.all(
      key.split(',').map(async (k) => {
        const [ticker, start] = k.split('|')
        try {
          return [k, toBars(await fetchDataset<PriceRow>('TaiwanStockPrice', ticker, start))] as const
        } catch {
          return [k, null] as const
        }
      }),
    ).then((pairs) => {
      if (!alive) return
      setBars(Object.fromEntries(pairs))
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [key])

  const items = open.map((plan) => {
    const series = plan.market === 'TW' ? bars[`${plan.ticker}|${startFor(plan)}`] : null
    const holding = holdings.find((h) => h.ticker.trim().toUpperCase().replace(/\.TWO?$/, '') === plan.ticker.toUpperCase() && h.shares > 0)
    const fallback = holding ? { close: holding.currentPrice, date: holding.priceUpdatedAt ?? '' } : undefined
    return { plan, status: positionStatus(plan, series ?? [], fallback), degraded: !series || series.length === 0 }
  })
  return { items, loading }
}
