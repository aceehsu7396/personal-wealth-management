import { describe, expect, it } from 'vitest'
import type { StockThesis, TradingStrategy } from '../storage/schema'
import { isStockCode, researchBlocks, strategiesForThesis, thesesForStrategy } from './strategyLink'

const thesis = (over: Partial<StockThesis>) => ({ id: over.ticker, ticker: '2330', market: 'TW', status: 'watch', verdict: 'invest', ...over }) as StockThesis
const strategy = (over: Partial<TradingStrategy>) => ({ id: 's', name: 's', symbols: [], status: 'dev', ...over }) as TradingStrategy

describe('research and strategy link', () => {
  it('tells ETFs from individual stocks', () => {
    expect(isStockCode('TW', '2330')).toBe(true)
    expect(isStockCode('TW', '0050')).toBe(false)
    expect(isStockCode('US', 'AAPL')).toBe(false)
  })

  it('finds each symbol’s research card by code, skipping exited cards', () => {
    const theses = [thesis({ ticker: '2330.TW' }), thesis({ ticker: '2317', status: 'exited' }), thesis({ ticker: 'spy', market: 'US' })]
    const linked = thesesForStrategy(strategy({ symbols: ['TW:2330', 'TW:2317', 'TW:0050', 'US:SPY'] }), theses)
    expect(linked.map((l) => [l.code, l.thesis?.ticker ?? null, l.isStock])).toEqual([
      ['2330', '2330.TW', true],
      ['2317', null, true],
      ['0050', null, false],
      ['SPY', 'spy', false],
    ])
  })

  it('lists the strategies trading a card, not retired ones', () => {
    const list = strategiesForThesis(thesis({ ticker: '2330' }), [
      strategy({ id: 'a', symbols: ['TW:2330'] }),
      strategy({ id: 'b', symbols: ['TW:2330'], status: 'retired' }),
      strategy({ id: 'c', symbols: ['US:2330'] }),
      strategy({ id: 'd', symbols: ['TW:0050', 'TW:2330'] }),
    ])
    expect(list.map((s) => s.id)).toEqual(['a', 'd'])
  })

  it('blocks on a pass verdict or a review/exit advice', () => {
    expect(researchBlocks({ verdict: 'pass' }, null)).toEqual(['研究卡結論為不投資'])
    expect(researchBlocks({ verdict: 'invest' }, { action: 'review', headline: '持股出現警訊' })).toEqual(['研究卡建議需要複查：持股出現警訊'])
    expect(researchBlocks({ verdict: 'invest' }, { action: 'buy', headline: '' })).toEqual([])
  })
})
