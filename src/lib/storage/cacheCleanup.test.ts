import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_FULL_EVENT, purgeCaches, setItemMakingRoom } from './cacheCleanup'
import { writeCache } from '../research/finmind'

// A Storage stand-in with a character quota, like the browser's.
function quotaStorage(limit: number) {
  const store = new Map<string, string>()
  const used = () => [...store].reduce((n, [k, v]) => n + k.length + v.length, 0)
  return {
    store,
    get length() {
      return store.size
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const next = used() - (store.get(k)?.length ?? 0) + v.length + (store.has(k) ? 0 : k.length)
      if (next > limit) throw new DOMException('quota', 'QuotaExceededError')
      store.set(k, v)
    },
    removeItem: (k: string) => void store.delete(k),
  }
}

describe('cache cleanup', () => {
  let storage: ReturnType<typeof quotaStorage>
  beforeEach(() => {
    storage = quotaStorage(2000)
    vi.stubGlobal('localStorage', storage)
  })

  it('removes only expired timed caches', () => {
    const now = Date.now()
    storage.setItem('pfm:finmind:TaiwanStockPrice:2330:2025-11-03', JSON.stringify({ at: now - 2 * 86_400_000, data: [] }))
    storage.setItem('pfm:finmind:TaiwanStockPrice:2330:2025-11-05', JSON.stringify({ at: now, data: [] }))
    storage.setItem('pfm:prices:TW:2330', '{"bars":[]}')
    storage.setItem('pfm:appData', '{}')
    expect(purgeCaches('expired', now)).toBe(1)
    expect([...storage.store.keys()].sort()).toEqual(['pfm:appData', 'pfm:finmind:TaiwanStockPrice:2330:2025-11-05', 'pfm:prices:TW:2330'])
  })

  it('frees the caches when the app data does not fit', () => {
    storage.setItem('pfm:prices:TW:2330', 'x'.repeat(1500))
    setItemMakingRoom('pfm:appData', 'y'.repeat(1000))
    expect(storage.getItem('pfm:appData')).toHaveLength(1000)
    expect(storage.getItem('pfm:prices:TW:2330')).toBeNull()
  })

  it('reports when even the cleared storage is too small', () => {
    const onFull = vi.fn()
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => e.type === STORAGE_FULL_EVENT && onFull() })
    setItemMakingRoom('pfm:appData', 'y'.repeat(5000))
    expect(onFull).toHaveBeenCalledOnce()
  })

  it('drops expired dated caches before writing a new one', () => {
    storage.setItem('pfm:finmind:old', JSON.stringify({ at: Date.now() - 3 * 86_400_000, data: ['z'.repeat(1500)] }))
    writeCache('pfm:finmind:new', ['a'.repeat(800)])
    expect(storage.getItem('pfm:finmind:old')).toBeNull()
    expect(storage.getItem('pfm:finmind:new')).not.toBeNull()
  })
})
