import { useMemo } from 'react'
import { useRegime } from './market/useRegime'
import { useDailyMarket } from './market/useDailyMarket'
import { dailyMetrics } from './market/regime'
import { reviewHistory } from './calculations/regimeReview'

// Every regime segment of the past four years judged in hindsight
// (blueprint 02 §6.1), shared by the review card and the annual report.
export function useRegimeReview() {
  const { history } = useRegime()
  const { data } = useDailyMarket()
  return useMemo(() => {
    const taiex = data?.series.TAIEX ?? []
    if (!history || taiex.length === 0) return null
    const dd = new Map(dailyMetrics(taiex).map((m, i) => [taiex[i].date, m.drawdown]))
    return reviewHistory(history.segments, history.dates, (d) => dd.get(d) ?? null)
  }, [history, data])
}
