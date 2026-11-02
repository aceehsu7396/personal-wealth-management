import { describe, expect, it } from 'vitest'
import { prefillFromSearch, signalTradeLink, tradeLink } from './tradeLink'
import type { SignalReport } from '../research/signals'

const holding = { id: 'h1', ticker: '2317', name: '鴻海', sleeve: 'satellite_tw', currency: 'TWD', shares: 1000, avgCost: 200, currentPrice: 230, createdAt: '' } as never

describe('trade links', () => {
  it('round-trips the order details through the URL', () => {
    const url = tradeLink({ ticker: '2317', side: 'buy', reason: 'tranche_1', thesisId: 't1', shares: 300, price: 231.5, stopLoss: 210 })
    const p = prefillFromSearch(new URLSearchParams(url.split('?')[1]), [holding], [{ id: 't1', name: '鴻海' } as never], [])!
    expect(p).toMatchObject({ side: 'buy', reason: 'tranche_1', holdingId: 'h1', ticker: '2317', thesisId: 't1', shares: '300', price: '231.5', stopLoss: '210' })
  })

  it('falls back to sensible defaults and ignores unknown values', () => {
    const p = prefillFromSearch(new URLSearchParams('ticker=TW:2454&side=sell&reason=bogus&strategy=nope'), [], [], [])!
    expect(p).toMatchObject({ ticker: '2454', side: 'sell', reason: 'exit_overvalued', holdingId: '', strategyId: '', sleeve: 'satellite_tw' })
    expect(prefillFromSearch(new URLSearchParams(''), [], [], [])).toBeNull()
  })

  it('turns research-card advice into the matching trade', () => {
    const report = (o: Partial<SignalReport>) => ({ action: 'buy', suggestedShares: 300, stopLoss: 210, heldShares: null, ...o }) as SignalReport
    const thesis = { id: 't1', ticker: '2317', verdict: 'invest' as const, currentPrice: 230 }
    expect(signalTradeLink(report({}), thesis)!.label).toBe('記錄買進（第 1 批）')
    expect(signalTradeLink(report({ action: 'add' }), thesis)!.to).toContain('reason=tranche_2')
    const trim = signalTradeLink(report({ action: 'trim', heldShares: 900 }), thesis)!
    expect(trim.to).toContain('side=sell')
    expect(trim.to).toContain('shares=300')
    expect(signalTradeLink(report({ action: 'exit', heldShares: 900 }), { ...thesis, verdict: 'pass' })!.to).toContain('reason=exit_thesis_broken')
    expect(signalTradeLink(report({ action: 'wait' }), thesis)).toBeNull()
  })
})
