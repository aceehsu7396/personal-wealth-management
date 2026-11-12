import { createContext, useContext } from 'react'
import type { useSync } from './useSync'

export const SyncContext = createContext<ReturnType<typeof useSync> | null>(null)

export function useSyncContext(): ReturnType<typeof useSync> {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSyncContext 需要在 SyncProvider 之內')
  return ctx
}
