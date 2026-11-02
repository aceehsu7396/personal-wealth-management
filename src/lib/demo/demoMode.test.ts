import { beforeEach, describe, expect, it, vi } from 'vitest'
import demo from './demo-data.json'
import { AppDataSchema, createDefaultAppData, SCHEMA_VERSION } from '../storage/schema'
import { computeJourney } from '../calculations/journey'

describe('demo data', () => {
  it('is valid app data that completes every roadmap step', () => {
    const data = AppDataSchema.parse(demo)
    const journey = computeJourney(data as never, '2026-10-30')
    expect(journey.stages.flatMap((s) => s.steps).filter((s) => !s.done).map((s) => s.id)).toEqual([])
    expect(data.trades.some((t) => t.reason === 'strategy_entry' && t.checklist.every((c) => c.passed))).toBe(true)
  })
})

describe('demo mode', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} })
    vi.resetModules()
  })

  it('sets the user data aside and restores it exactly', async () => {
    const own = { ...createDefaultAppData(), watchlist: [{ symbol: 'TW:1234', name: '我的', industry: '', priceAtAdd: null, source: '', note: '', addedAt: '' }] }
    const saved = JSON.stringify({ state: own, version: SCHEMA_VERSION })
    store.set('pfm:appData', saved)
    const { useAppStore } = await import('../storage/appStore')
    await useAppStore.persist.rehydrate()
    const { loadDemo, exitDemo, isDemoActive } = await import('./demoMode')

    await loadDemo()
    expect(isDemoActive()).toBe(true)
    expect(useAppStore.getState().stockTheses[0].ticker).toBe('2330')
    // Changes during the demo stay in the demo.
    useAppStore.getState().addWatchItem({ symbol: 'TW:9999', name: '示範中新增', industry: '', priceAtAdd: null, source: '', note: '' })

    await exitDemo()
    expect(isDemoActive()).toBe(false)
    expect(useAppStore.getState().watchlist.map((w) => w.symbol)).toEqual(['TW:1234'])
    expect(store.get('pfm:appData')).toBe(saved)
    expect(store.has('pfm:appData:before-demo')).toBe(false)
  })
})
