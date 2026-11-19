import { describe, expect, it } from 'vitest'
import type { Bar } from '../market/priceHistory'
import type { PaperAccount, TradingStrategy } from '../storage/schema'
import { createDefaultInvestmentPolicy } from '../storage/schema'
import { priceSymbols, routineAccounts, runPaperRoutine, type RoutineDeps } from './routine'

const bars: Bar[] = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 7, 1 + i))
  const close = i < 59 ? 100 : 110
  return { date: d.toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 1000 }
})
const last = bars.at(-1)!

const card = (id: string, status: TradingStrategy['status']): TradingStrategy =>
  ({ id, name: id, template: 'donchian', params: { entryDays: 20, exitDays: 10, atrStop: 2 }, symbols: ['TW:1111'], edge: '', entryRules: '', exitRules: '', riskPerTradePercent: 1, status, notes: '', createdAt: '', updatedAt: '' }) as TradingStrategy

const account = (id: string, strategyId: string): PaperAccount => ({
  id,
  name: id,
  market: 'TW',
  initialCash: 1_000_000,
  cash: 900_000,
  strategyId,
  positions: [{ symbol: 'TW:2222', name: '', shares: 100, avgCost: 1000, lastPrice: 1000, lastPriceDate: '2026-08-01', stopLoss: 950, openedAt: '2026-08-01' }],
  orders: [],
  equityHistory: [],
  signalLog: [],
  createdAt: '',
})

describe('runPaperRoutine', () => {
  it('updates prices for every account, and suggests for accounts on paper cards only', async () => {
    const strategies = [card('p', 'paper'), card('d', 'dev')]
    const store: Record<string, PaperAccount> = { a: account('a', 'p'), b: account('b', 'd') }
    expect(routineAccounts(Object.values(store), strategies).map((x) => x.account.id)).toEqual(['a'])
    const deps: RoutineDeps = {
      fetchQuotes: async (symbols) => Object.fromEntries(symbols.map((s) => [s, { price: 1010, date: last.date }])),
      loadPriceData: async (symbols) => Object.fromEntries(symbols.map((s) => [s, bars])),
      loadChipData: async () => ({}),
    }
    const res = await runPaperRoutine(
      { accounts: Object.values(store), strategies, policy: createDefaultInvestmentPolicy(), regime: null, today: last.date, onStep: () => {}, latest: (id) => store[id], save: (a) => (store[a.id] = a) },
      deps,
    )
    expect(res).toEqual({ done: ['a', 'b'], failed: [], missing: [] })
    expect(store.a.positions[0].lastPrice).toBe(1010)
    expect(store.b.positions[0].lastPrice).toBe(1010)
    expect(store.b.quotes?.['TW:1111'].price).toBe(1010)
    expect(store.a.assistant?.items.find((i) => i.symbol === 'TW:1111')?.kind).toBe('enter')
    expect(store.b.assistant).toBeUndefined()
  })

  it('keeps going when one account fails', async () => {
    const strategies = [card('p', 'paper')]
    const store: Record<string, PaperAccount> = { a: account('a', 'p'), b: account('b', 'p') }
    let calls = 0
    const deps: RoutineDeps = {
      fetchQuotes: async () => {
        if (calls++ === 0) throw new Error('down')
        return {}
      },
      loadPriceData: async (symbols) => Object.fromEntries(symbols.map((s) => [s, bars])),
      loadChipData: async () => ({}),
    }
    const res = await runPaperRoutine(
      { accounts: Object.values(store), strategies, policy: createDefaultInvestmentPolicy(), regime: null, today: last.date, onStep: () => {}, latest: (id) => store[id], save: (a) => (store[a.id] = a) },
      deps,
    )
    expect(res.done).toEqual(['b'])
    expect(res.failed.map((f) => f.name)).toEqual(['a'])
  })
})

describe('price symbols', () => {
  it('adds the card symbols in the account market', () => {
    const a = { id: 'a', name: '', market: 'TW' as const, initialCash: 1, cash: 1, positions: [], orders: [], equityHistory: [], signalLog: [], createdAt: '' }
    expect(priceSymbols(a, { symbols: ['TW:2330', 'US:SPY'] })).toEqual(['TW:2330'])
  })
})
