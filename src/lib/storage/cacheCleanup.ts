// Downloaded data cached in localStorage beside the app data. All of it can
// be fetched again, so it gives way whenever the app data needs the space.
// Timed caches ({ at, data }) expire after a day; their keys often carry a
// date, so expired entries must be removed or they pile up until the
// browser's quota (about 5 MB) is full and the app data can no longer save.

export const TIMED_CACHE_PREFIXES = ['pfm:finmind:', 'pfm:indices:']
// Backtest price series: kept until space is needed.
export const PRICE_CACHE_PREFIX = 'pfm:prices:'
export const CACHE_MAX_AGE_MS = 24 * 3600 * 1000

export const STORAGE_FULL_EVENT = 'pfm:storage-full'

function cacheKeys(prefixes: string[]): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && prefixes.some((p) => key.startsWith(p))) keys.push(key)
  }
  return keys
}

// The write time sits at the start of each entry, so it is read without
// parsing the whole (possibly large) value.
function writtenAt(raw: string | null): number | null {
  const match = raw?.match(/^\{"at":(\d+)/)
  return match ? Number(match[1]) : null
}

// Removes expired timed caches, or with `all` every cache including price
// series. Returns how many entries were removed.
export function purgeCaches(mode: 'expired' | 'all', now = Date.now()): number {
  try {
    const keys =
      mode === 'all'
        ? cacheKeys([...TIMED_CACHE_PREFIXES, PRICE_CACHE_PREFIX])
        : cacheKeys(TIMED_CACHE_PREFIXES).filter((k) => {
            const at = writtenAt(localStorage.getItem(k))
            return at === null || now - at >= CACHE_MAX_AGE_MS
          })
    for (const k of keys) localStorage.removeItem(k)
    return keys.length
  } catch {
    return 0
  }
}

// Writes the app data; when the quota is full, frees the caches and tries
// once more, then tells the page (banner) instead of failing silently.
export function setItemMakingRoom(name: string, value: string): void {
  try {
    localStorage.setItem(name, value)
    return
  } catch {
    purgeCaches('all')
  }
  try {
    localStorage.setItem(name, value)
  } catch (error) {
    console.warn('[storage] 瀏覽器儲存空間已滿，資料未能儲存', error)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_FULL_EVENT))
  }
}
