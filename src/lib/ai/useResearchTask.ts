import { useCallback, useState } from 'react'
import { describeAiError } from './client'
import { getApiKey } from './apiKeyStorage'

// Runs one AI research task at a time and exposes its status for buttons.
export function useResearchTask() {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T | null> => {
    setRunning(true)
    setError(null)
    try {
      return await task()
    } catch (e) {
      setError(describeAiError(e))
      return null
    } finally {
      setRunning(false)
    }
  }, [])

  return { running, error, run, hasApiKey: Boolean(getApiKey()) }
}
