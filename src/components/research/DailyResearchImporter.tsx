import { useEffect } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { fetchDailyResearch, runsToImport } from '../../lib/research/dailyResearch'
import { isDemoActive } from '../../lib/demo/demoMode'

// Mounted once in the app shell: the 06:00 automatic research runs not yet
// imported become research cards and comparisons (handbook 06 §1.1).
export function DailyResearchImporter() {
  const importDailyResearch = useAppStore((s) => s.importDailyResearch)

  useEffect(() => {
    if (isDemoActive()) return
    let cancelled = false
    void fetchDailyResearch().then((file) => {
      if (cancelled || !file || isDemoActive()) return
      for (const run of runsToImport(file, useAppStore.getState().dailyResearchImported)) importDailyResearch(run)
    })
    return () => {
      cancelled = true
    }
  }, [importDailyResearch])

  return null
}
