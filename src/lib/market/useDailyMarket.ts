import { useCallback, useEffect, useMemo, useState } from 'react'
import { INDEX_DEFS, fetchIndicesSnapshot, loadIndices, type IndexKey, type LoadedIndices } from './indices'
import { breadthRatio, indexTrend, type IndexTrend } from './trend'

// One load shared by every page that shows the indexes; refresh replaces it.
let shared: Promise<LoadedIndices> | null = null

export interface DailyMarket {
  data: LoadedIndices | null
  trends: Partial<Record<IndexKey, IndexTrend | null>>
  usBreadth: ReturnType<typeof breadthRatio>
  loading: boolean
  refresh: () => void
}

export function useDailyMarket(): DailyMarket {
  const [data, setData] = useState<LoadedIndices | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((force: boolean) => {
    if (force || !shared) shared = fetchIndicesSnapshot().then((snapshot) => loadIndices(snapshot))
    setLoading(true)
    let alive = true
    shared
      .then((d) => alive && setData(d))
      .catch((e) => console.warn('[useDailyMarket] 讀取指數失敗', e))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => load(false), [load])

  const trends = useMemo(
    () => Object.fromEntries(INDEX_DEFS.map((d) => [d.key, indexTrend(data?.series[d.key] ?? [])])) as DailyMarket['trends'],
    [data],
  )
  const usBreadth = useMemo(() => breadthRatio(data?.series.RSP ?? [], data?.series.SPY ?? []), [data])
  const refresh = useCallback(() => void load(true), [load])

  return { data, trends, usBreadth, loading, refresh }
}
