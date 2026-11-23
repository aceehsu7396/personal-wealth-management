import { useEffect, useState } from 'react'
import { fetchHealth, type HealthFile } from './freshness'

// The published freshness check, fetched once per visit and shared.
let pending: Promise<HealthFile | null> | null = null

export function useDataHealth(): HealthFile | null {
  const [health, setHealth] = useState<HealthFile | null>(null)
  useEffect(() => {
    let cancelled = false
    pending ??= fetchHealth()
    void pending.then((h) => {
      if (!cancelled) setHealth(h)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return health
}
