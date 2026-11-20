import { useEffect, useState } from 'react'
import { fetchActiveEtf, type ActiveEtfFile } from './activeEtf'

// The active ETF holdings file, fetched once per visit and shared.
let pending: Promise<ActiveEtfFile | null> | null = null

export function useActiveEtf(): { file: ActiveEtfFile | null; loading: boolean } {
  const [file, setFile] = useState<ActiveEtfFile | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    pending ??= fetchActiveEtf()
    void pending.then((f) => {
      if (cancelled) return
      setFile(f)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return { file, loading }
}
