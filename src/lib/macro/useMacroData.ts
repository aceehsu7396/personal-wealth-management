import { useEffect, useState } from 'react'
import { fetchMacroData, type MacroData } from './macroData'

// One download per page load, shared by every reader.
let shared: Promise<MacroData | null> | null = null

export function useMacroData(): MacroData | null {
  const [data, setData] = useState<MacroData | null>(null)
  useEffect(() => {
    if (!shared) shared = fetchMacroData()
    let alive = true
    void shared.then((d) => alive && setData(d))
    return () => {
      alive = false
    }
  }, [])
  return data
}
