import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAppData, SCHEMA_VERSION } from './schema'

const blank = () => createDefaultAppData()

describe('appStore storage', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
  })

  it('restores a backup that validates after a schema fix', async () => {
    const card = {
      id: 'x', ticker: '00878', name: 'ETF', market: 'TW', sector: 'ETF', lynchCategory: 'stalwart',
      inCircleOfCompetence: true, status: 'watch', thesis: '', drivers: '', killCriteria: '', sources: '', preMortem: '',
      fiveForces: { rivalry: 3, newEntrants: 3, substitutes: 3, buyerPower: 3, supplierPower: 3 },
      powers: { scaleEconomies: 0, networkEconomies: 0, counterPositioning: 0, switchingCosts: 0, branding: 0, corneredResource: 0, processPower: 0 },
      hasUnexplainedRedFlags: false, fairValueBear: 0, fairValueBase: 0, fairValueBull: 0, currentPrice: 35,
      updatedAt: '', createdAt: '',
    }
    store.set('pfm:appData:corrupted-backup', JSON.stringify({ state: { ...blank(), stockTheses: [card] }, version: SCHEMA_VERSION }))
    store.set('pfm:appData', JSON.stringify({ state: blank(), version: SCHEMA_VERSION }))
    const { useAppStore } = await import('./appStore')
    await useAppStore.persist.rehydrate()
    expect(useAppStore.getState().stockTheses.map((t) => t.ticker)).toEqual(['00878'])
    expect(store.has('pfm:appData:corrupted-backup')).toBe(false)
    expect(store.has('pfm:appData:before-restore')).toBe(true)
  })

  it('keeps the current data when it holds more records', async () => {
    store.set('pfm:appData:corrupted-backup', JSON.stringify({ state: blank(), version: SCHEMA_VERSION }))
    store.set('pfm:appData', JSON.stringify({ state: { ...blank(), watchlist: [{ symbol: '2330', name: '台積電', priceAtAdd: null, addedAt: '' }] }, version: SCHEMA_VERSION }))
    const { useAppStore } = await import('./appStore')
    await useAppStore.persist.rehydrate()
    expect(store.has('pfm:appData:corrupted-backup')).toBe(true)
  })
})
