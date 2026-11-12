import { useSync } from '../../lib/sync/useSync'
import { SyncContext } from '../../lib/sync/syncContext'

// Runs sync once for the whole app: checks the vault on open and uploads a
// while after each change.
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const sync = useSync()
  return <SyncContext.Provider value={sync}>{children}</SyncContext.Provider>
}
