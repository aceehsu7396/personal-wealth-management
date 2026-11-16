import { describe, expect, it } from 'vitest'
import type { BacktestRun, PaperAccount, TradingStrategy } from '../storage/schema'
import { cardKey, cleanupSuggestions, findDuplicate, groupCards, symbolNames } from './cardGroups'

const card = (id: string, symbols: string[], status: TradingStrategy['status'] = 'dev', extra: Partial<TradingStrategy> = {}): TradingStrategy => ({
  id,
  name: id,
  template: 'donchian',
  params: { entryDays: 55 },
  symbols,
  edge: '',
  entryRules: '',
  exitRules: '',
  riskPerTradePercent: 1,
  status,
  notes: '',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...extra,
})

const stats = (cagr: number) => ({ totalReturn: cagr, cagr, maxDrawdown: -0.2, sharpe: cagr * 5, trades: 30, winRate: 0.5, profitFactor: 1.5, exposure: 0.5 })
const run = (strategyId: string, pass: boolean, createdAt = '2026-09-02T00:00:00Z'): BacktestRun =>
  ({
    id: strategyId + createdAt,
    strategyId,
    label: '',
    template: 'donchian',
    params: {},
    symbols: [],
    start: '',
    end: '',
    initialCapital: 1,
    outOfSampleStart: null,
    dividendAdjusted: true,
    stats: { full: stats(0.1), inSample: stats(0.1), outOfSample: stats(pass ? 0.3 : 0.01) },
    benchmark: { full: stats(0.1), inSample: stats(0.1), outOfSample: stats(0.1) },
    equity: [],
    createdAt,
  }) as BacktestRun

const account = (strategyId: string): PaperAccount => ({ id: 'a', name: 'a', market: 'TW', initialCash: 1, cash: 1, strategyId, positions: [], orders: [], equityHistory: [], signalLog: [], createdAt: '2026-11-01T00:00:00Z' })

describe('card groups', () => {
  const cards = [card('a', ['TW:2330']), card('b', ['TW:2330'], 'paper'), card('c', ['TW:0050']), card('d', ['TW:0050', 'TW:00646']), card('e', ['TW:2330'], 'retired')]
  const ctx = { runs: [run('a', true)], accounts: [account('b')], names: { 'TW:2330': '台積電' } }

  it('groups by symbol: active single symbols first, combinations after, retired last', () => {
    const g = groupCards(cards, 'symbol', ctx)
    expect(g.map((x) => x.label)).toEqual(['2330 台積電', '0050', '0050、00646', '已停用'])
    expect(g[0].cards.map((c) => c.id)).toEqual(['b', 'a'])
    expect(g[0].summary).toBe('2 張：虛擬交易 1、開發中 1（開發中有 1 張回測通過）')
    expect(g.at(-1)).toMatchObject({ retired: true, summary: '1 張' })
  })

  it('groups by status and by template', () => {
    expect(groupCards(cards, 'status', ctx).map((x) => x.label)).toEqual(['虛擬交易', '開發中：回測通過', '開發中：未通過或未回測', '已停用'])
    expect(groupCards(cards, 'template', ctx).map((x) => x.cards.length)).toEqual([4, 1])
  })

  it('finds a duplicate by template, resolved parameters and symbol set', () => {
    expect(cardKey(card('x', ['TW:2', 'TW:1']))).toBe(cardKey(card('y', ['TW:1', 'TW:2'], 'dev', { params: { entryDays: 55, exitDays: 20 } })))
    expect(findDuplicate(cards, card('z', ['TW:2330']))?.id).toBe('a')
    expect(findDuplicate([card('r', ['TW:1'], 'retired')], card('z', ['TW:1']))).toBeUndefined()
  })

  it('suggests retiring stale failed cards without paper accounts only', () => {
    const list = [card('f', ['TW:1']), card('g', ['TW:2']), card('h', ['TW:3']), card('i', ['TW:4'], 'dev', { updatedAt: '2026-11-10T00:00:00Z' })]
    const runs = [run('f', false), run('g', true), run('h', false), run('i', false)]
    const out = cleanupSuggestions(list, runs, [account('h')], '2026-11-16')
    expect(out.map((s) => s.card.id)).toEqual(['f'])
    expect(out[0].reason).toContain('未通過')
  })

  it('names symbols from what the trader keeps', () => {
    const names = symbolNames({ watchlist: [{ symbol: 'TW:2330', name: '台積電' }], stockTheses: [{ ticker: '2317', name: '鴻海', market: 'TW' }], paperAccounts: [], holdings: [{ ticker: 'AAPL', name: 'Apple', currency: 'USD' }] })
    expect(names).toEqual({ 'TW:2330': '台積電', 'TW:2317': '鴻海', 'US:AAPL': 'Apple' })
  })
})
