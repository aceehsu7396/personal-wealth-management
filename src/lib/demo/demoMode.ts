import { useSyncExternalStore } from 'react'
import { STORAGE_KEY, useAppStore } from '../storage/appStore'
import { AppDataSchema } from '../storage/schema'

// Demo mode (handbook chapter 12): the worked example replaces the app data
// for a while. The user's own data is set aside first and put back exactly
// when the demo ends; nothing done during the demo touches it.

const BACKUP_KEY = `${STORAGE_KEY}:before-demo`
const FLAG_KEY = 'pfm:demoActive'
const EVENT = 'pfm-demo-change'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function isDemoActive(): boolean {
  return read(FLAG_KEY) === '1'
}

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export async function loadDemo(): Promise<void> {
  const { default: demo } = await import('./demo-data.json')
  const data = AppDataSchema.parse(demo)
  // Keep the backup from the first load if the demo is loaded again.
  if (!isDemoActive()) {
    const own = read(STORAGE_KEY)
    if (own !== null) localStorage.setItem(BACKUP_KEY, own)
    else localStorage.removeItem(BACKUP_KEY)
  }
  localStorage.setItem(FLAG_KEY, '1')
  useAppStore.getState().importData(data)
  notify()
}

export async function exitDemo(): Promise<void> {
  const backup = read(BACKUP_KEY)
  localStorage.removeItem(FLAG_KEY)
  if (backup !== null) {
    localStorage.setItem(STORAGE_KEY, backup)
    localStorage.removeItem(BACKUP_KEY)
    await useAppStore.persist.rehydrate()
  } else {
    useAppStore.getState().resetAllData()
  }
  notify()
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

export function useDemoActive(): boolean {
  return useSyncExternalStore(subscribe, isDemoActive, () => false)
}
