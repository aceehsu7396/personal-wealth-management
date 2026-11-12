import { fromB64url } from '../sync/crypto'

// Payload-free Web Push (stage 6): the Worker only wakes the browser; the
// service worker (public/sw.js) writes the notification from the site's
// public daily brief and this device's own count of today's items, so no
// personal data reaches the server.

const DB = 'pfm-push'
const STORE = 'kv'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface TodaySummary {
  date: string
  total: number
  required: number
  // The first item's text, e.g. a stop to act on.
  first?: string
}

// Kept for the service worker each time the day's items are computed.
export async function saveTodaySummary(summary: TodaySummary): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    const d = await db()
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(summary, 'today')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // Private mode or blocked storage: the push falls back to the brief.
  }
}

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
  } catch {
    return null
  }
}

const base = (url: string) => url.trim().replace(/\/$/, '')

export async function enablePush(workerUrl: string, token: string): Promise<void> {
  if (!pushSupported()) throw new Error('這個瀏覽器不支援推播；iPhone 要先把網站「加入主畫面」再從主畫面打開')
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('沒有允許通知：請在瀏覽器設定裡允許這個網站的通知')
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready)
  const info = (await (await fetch(`${base(workerUrl)}/`)).json()) as { vapidPublicKey?: string }
  if (!info.vapidPublicKey) throw new Error('同步伺服器還沒設定推播金鑰（VAPID_PUBLIC_KEY）')
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(info.vapidPublicKey) as BufferSource })
  const res = await fetch(`${base(workerUrl)}/push/subscribe`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })
  if (!res.ok) throw new Error(`推播訂閱失敗（${res.status}）`)
}

export async function disablePush(workerUrl: string, token: string): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await fetch(`${base(workerUrl)}/push/unsubscribe`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })
  await sub.unsubscribe()
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  return !!(await reg?.pushManager.getSubscription())
}

export async function testPush(workerUrl: string, token: string): Promise<number> {
  const res = await fetch(`${base(workerUrl)}/push/test`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`測試推播失敗（${res.status}）`)
  return ((await res.json()) as { sent: number }).sent
}
