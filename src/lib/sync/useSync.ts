import { useCallback, useEffect, useRef, useState } from 'react'
import { STORAGE_KEY, useAppStore } from '../storage/appStore'
import { isDemoActive } from '../demo/demoMode'
import { deriveKeys, fromB64url, importAesKey, open, seal, sha256Hex } from './crypto'
import { decide, isBlank, SyncError, vaultClient, type SyncState, type VaultRecord } from './sync'

// Cross-device sync of the app data (stage 6). Settings live in their own
// key and are never synced; the passphrase is never stored. "Remember this
// device" keeps only the derived key and token in this browser.

export const SYNC_SETTINGS_KEY = 'pfm:sync'
export const UPLOAD_DELAY_MS = 2 * 60 * 1000

export interface SyncSettings {
  url: string
  vaultId?: string
  token?: string
  rawKey?: string
  state?: SyncState
}

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'locked' }
  | { kind: 'idle'; at?: string }
  | { kind: 'busy'; message: string }
  | { kind: 'conflict'; remote: VaultRecord }
  // No vault for this passphrase yet: a typo or a first device.
  | { kind: 'confirmNew' }
  | { kind: 'error'; message: string }

export function readSettings(): SyncSettings {
  try {
    return JSON.parse(localStorage.getItem(SYNC_SETTINGS_KEY) ?? '{}') as SyncSettings
  } catch {
    return { url: '' }
  }
}

function writeSettings(s: SyncSettings) {
  try {
    localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // Storage blocked: sync keeps working for this session.
  }
}

// Keys for this session when the device is not remembered.
let sessionKeys: { aesKey: CryptoKey; token: string; vaultId: string } | null = null

const localData = () => localStorage.getItem(STORAGE_KEY) ?? ''

// One instance for the whole app: see SyncProvider and useSyncContext.
export function useSync() {
  const [settings, setSettings] = useState<SyncSettings>(readSettings)
  const [status, setStatus] = useState<SyncStatus>({ kind: 'off' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback((next: SyncSettings) => {
    writeSettings(next)
    setSettings(next)
  }, [])

  const keys = useCallback(async () => {
    if (sessionKeys) return sessionKeys
    const s = readSettings()
    if (s.rawKey && s.token && s.vaultId) {
      sessionKeys = { aesKey: await importAesKey(fromB64url(s.rawKey)), token: s.token, vaultId: s.vaultId }
      return sessionKeys
    }
    return null
  }, [])

  const client = useCallback(async () => {
    const s = readSettings()
    const k = await keys()
    return s.url && k ? vaultClient(s.url, k.vaultId, k.token) : null
  }, [keys])

  const remember = useCallback(
    (record: VaultRecord, hash: string) => {
      save({ ...readSettings(), state: { version: record.version, hash, at: record.updatedAt } })
      setStatus({ kind: 'idle', at: record.updatedAt })
    },
    [save],
  )

  const upload = useCallback(
    async (expected: number | null) => {
      const c = await client()
      const k = await keys()
      if (!c || !k) return
      const data = localData()
      setStatus({ kind: 'busy', message: '加密並上傳…' })
      const record = await c.put(await seal(k.aesKey, data), expected)
      remember(record, await sha256Hex(data))
    },
    [client, keys, remember],
  )

  const download = useCallback(
    async (record: VaultRecord) => {
      const k = await keys()
      if (!k) return
      setStatus({ kind: 'busy', message: '下載並解密…' })
      const data = await open(k.aesKey, record.sealed)
      localStorage.setItem(STORAGE_KEY, data)
      remember(record, await sha256Hex(data))
      // Reload so every page reads the downloaded data.
      location.reload()
    },
    [keys, remember],
  )

  // Compare with the vault and act; a conflict waits for the trader.
  const syncNow = useCallback(async () => {
    if (isDemoActive()) return setStatus({ kind: 'error', message: '示範模式不同步；結束示範後再同步' })
    try {
      const c = await client()
      if (!c) return setStatus({ kind: readSettings().url ? 'locked' : 'off' })
      setStatus({ kind: 'busy', message: '檢查雲端版本…' })
      const remote = await c.get()
      const s = readSettings()
      const action = decide(remote?.version ?? null, s.state ?? null, await sha256Hex(localData()), isBlank(localData()))
      if (!remote && !s.state) setStatus({ kind: 'confirmNew' })
      else if (action === 'upload') await upload(remote?.version ?? null)
      else if (action === 'download') await download(remote!)
      else if (action === 'conflict') setStatus({ kind: 'conflict', remote: remote! })
      else setStatus({ kind: 'idle', at: s.state?.at })
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof SyncError ? e.message : `同步失敗：${(e as Error).message}` })
    }
  }, [client, upload, download])

  // First visit of the session, and an upload a while after each change.
  useEffect(() => {
    void syncNow()
    const unsub = useAppStore.subscribe(() => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void syncNow(), UPLOAD_DELAY_MS)
    })
    const onHide = () => {
      if (document.visibilityState === 'hidden' && timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        void syncNow()
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onHide)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [syncNow])

  const unlock = useCallback(
    async (url: string, passphrase: string, rememberDevice: boolean) => {
      setStatus({ kind: 'busy', message: '由密語推導金鑰（約 1 秒）…' })
      try {
        const k = await deriveKeys(passphrase)
        sessionKeys = { aesKey: k.aesKey, token: k.token, vaultId: k.vaultId }
        const prev = readSettings()
        // A different vault starts with no remembered version.
        const state = prev.vaultId === k.vaultId ? prev.state : undefined
        save({ url: url.trim(), vaultId: k.vaultId, state, ...(rememberDevice ? { token: k.token, rawKey: k.rawKey } : {}) })
        await syncNow()
      } catch (e) {
        setStatus({ kind: 'error', message: (e as Error).message })
      }
    },
    [save, syncNow],
  )

  const resolve = useCallback(
    async (keep: 'remote' | 'local' | 'create') => {
      try {
        if (keep === 'create' && status.kind === 'confirmNew') return await upload(null)
        if (status.kind !== 'conflict') return
        if (keep === 'remote') await download(status.remote)
        else await upload(status.remote.version)
      } catch (e) {
        setStatus({ kind: 'error', message: (e as Error).message })
      }
    },
    [status, download, upload],
  )

  const forget = useCallback(() => {
    sessionKeys = null
    save({ url: readSettings().url })
    setStatus({ kind: 'locked' })
  }, [save])

  return { settings, status, unlock, syncNow, resolve, forget, token: () => keys().then((k) => k?.token ?? null) }
}
