import type { Sealed } from './crypto'

// What to do when this device and the vault disagree (stage 6). Versions
// count uploads; the device remembers the version it last saw and a hash
// of the data at that time. No automatic merge: a wrong merge of trades or
// plans is worse than asking.

export type SyncAction = 'none' | 'download' | 'upload' | 'conflict'

export interface SyncState {
  // The vault version this device last uploaded or downloaded.
  version: number
  // Hash of the local data at that moment.
  hash: string
  at: string
}

// localBlank: this device holds nothing of the trader's own yet.
export function decide(remoteVersion: number | null, local: SyncState | null, localHash: string, localBlank = false): SyncAction {
  const localChanged = !local || local.hash !== localHash
  if (remoteVersion === null) return 'upload'
  if (!local) return localBlank ? 'download' : 'conflict'
  const remoteChanged = remoteVersion > local.version
  if (remoteChanged && localChanged) return 'conflict'
  if (remoteChanged) return 'download'
  if (localChanged) return 'upload'
  return 'none'
}

// No trades, holdings, research cards or plans: nothing to lose by
// replacing it with the vault.
export function isBlank(appData: string): boolean {
  if (!appData) return true
  try {
    const parsed = JSON.parse(appData) as { state?: Record<string, unknown[]> } & Record<string, unknown[]>
    const s = parsed.state ?? parsed
    return ['trades', 'holdings', 'stockTheses', 'tradePlans', 'decisions'].every((k) => !Array.isArray(s[k]) || s[k].length === 0)
  } catch {
    return false
  }
}

export interface VaultRecord {
  version: number
  updatedAt: string
  sealed: Sealed
}

export class SyncError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface VaultClient {
  get(): Promise<VaultRecord | null>
  put(sealed: Sealed, expectedVersion: number | null): Promise<VaultRecord>
}

type Fetcher = typeof fetch

export function vaultClient(baseUrl: string, vaultId: string, token: string, fetcher: Fetcher = (...a) => fetch(...a)): VaultClient {
  const url = `${baseUrl.replace(/\/$/, '')}/vault/${vaultId}`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const fail = async (res: Response) => {
    const text = await res.text().catch(() => '')
    const msg = res.status === 401 ? '密語不符：這個雲端保險箱是用別的密語建立的' : res.status === 409 ? '雲端版本已經更新：請先下載或選擇要保留哪一份' : `同步伺服器回應 ${res.status}${text ? `：${text}` : ''}`
    throw new SyncError(msg, res.status)
  }
  return {
    async get() {
      const res = await fetcher(url, { headers })
      if (res.status === 404) return null
      if (!res.ok) await fail(res)
      return (await res.json()) as VaultRecord
    },
    async put(sealed, expectedVersion) {
      const res = await fetcher(url, { method: 'PUT', headers, body: JSON.stringify({ sealed, expectedVersion }) })
      if (!res.ok) await fail(res)
      return (await res.json()) as VaultRecord
    },
  }
}
