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

  it('imports a daily research run once, and caps only your own comparisons', async () => {
    store.set('pfm:appData', JSON.stringify({ state: blank(), version: SCHEMA_VERSION }))
    const { useAppStore } = await import('./appStore')
    await useAppStore.persist.rehydrate()
    const auto = { kind: 'stock', name: 'X', industry: '', fetchedAt: '2026-11-20T00:00:00Z' }
    const comparison = { symbol: 'TW:2330', name: '', start: '', end: '', initialCapital: 1, outOfSampleStart: null, round: 0, trials: 1, rows: [], summary: { kind: 'none', headline: '', details: [], ranking: [] }, equity: [] }
    const run = { date: '2026-11-20', skipped: [], items: [{ screenId: 'value', screenName: '價值', code: '2330', name: 'X', auto, rating: 'strong', comparison }] } as never
    const s = useAppStore.getState()
    s.importDailyResearch(run)
    s.importDailyResearch(run)
    expect(useAppStore.getState().stockTheses).toHaveLength(1)
    expect(useAppStore.getState().strategyComparisons).toHaveLength(1)
    expect(useAppStore.getState().dailyResearchImported).toBe('2026-11-20')
    for (let i = 0; i < 25; i++) s.addStrategyComparison({ ...comparison, symbol: `TW:${i}` } as never)
    const list = useAppStore.getState().strategyComparisons
    expect(list.filter((c) => !c.auto)).toHaveLength(20)
    expect(list.filter((c) => c.auto)).toHaveLength(1)
  })

  it("keeps the daily research's runs apart from the cap on yours, and drops them with their card", async () => {
    store.set('pfm:appData', JSON.stringify({ state: blank(), version: SCHEMA_VERSION }))
    const { useAppStore } = await import('./appStore')
    await useAppStore.persist.rehydrate()
    const st = { totalReturn: 0, cagr: 0, maxDrawdown: 0, sharpe: null, trades: 0, winRate: null, profitFactor: null, exposure: 0 }
    const run = (auto: boolean, strategyId = 'x') => ({ strategyId, label: '', template: 'donchian', params: {}, symbols: [], start: '', end: '', initialCapital: 1, outOfSampleStart: null, dividendAdjusted: true, stats: { full: st, inSample: null, outOfSample: null }, benchmark: { full: st, inSample: null, outOfSample: null }, equity: [], ...(auto ? { auto: true } : {}) }) as never
    const s = useAppStore.getState()
    s.addBacktestRun(run(true, 'card1'))
    for (let i = 0; i < 45; i++) s.addBacktestRun(run(false))
    expect(useAppStore.getState().backtestRuns.filter((r) => !r.auto)).toHaveLength(40)
    expect(useAppStore.getState().backtestRuns.filter((r) => r.auto)).toHaveLength(1)
    s.removeTradingStrategy('card1')
    expect(useAppStore.getState().backtestRuns.filter((r) => r.auto)).toHaveLength(0)
  })
})
