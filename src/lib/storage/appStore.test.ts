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

  it('adds, updates and removes idea notes, stamping when one is done', async () => {
    const { useAppStore } = await import('./appStore')
    const s = () => useAppStore.getState()
    const id = s().addIdeaNote({ nodeId: 'screener', title: '依產業分組', page: '/research/screener' })
    expect(s().ideaNotes[0]).toMatchObject({ id, status: 'idea', priority: 'medium', detail: '', page: '/research/screener' })
    s().updateIdeaNote(id, { status: 'done' })
    expect(s().ideaNotes[0].doneAt).toBeDefined()
    s().updateIdeaNote(id, { status: 'planned', priority: 'high' })
    expect(s().ideaNotes[0]).toMatchObject({ status: 'planned', priority: 'high', doneAt: undefined })
    s().removeIdeaNote(id)
    expect(s().ideaNotes).toEqual([])
  })

  it('keeps the plan stop from moving down, and records rule versions', async () => {
    const { useAppStore } = await import('./appStore')
    const s = () => useAppStore.getState()
    const id = s().addTradePlan({
      status: 'open', source: 'thesis', ticker: '2330', name: '', market: 'TW', entryMethod: 'value_batches',
      setup: '', trigger: '', confirmation: '', stopMethod: 'atr', orderType: 'limit', orderNote: '',
      trailing: 'chandelier', targets: [], thesisExit: '', rules: [], advice: [], batches: [], currentStop: 885,
    })
    s().updateTradePlan(id, { currentStop: 1100 })
    expect(s().tradePlans[0].currentStop).toBe(1100)
    s().updateTradePlan(id, { currentStop: 900 })
    expect(s().tradePlans[0].currentStop).toBe(1100)
    s().addRuleVersion({ kind: 'policy', reason: '第一次簽署', snapshot: { riskPerTradePercent: 1 } })
    expect(s().ruleVersions[0]).toMatchObject({ kind: 'policy', reason: '第一次簽署' })
    s().removeTradePlan(id)
    expect(s().tradePlans).toEqual([])
  })
})
