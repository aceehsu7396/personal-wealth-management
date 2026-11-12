import { describe, expect, it } from 'vitest'
import { fee, orderTicket, sellTax, snap, splitLots, tickOf } from './orderTicket'
import type { TradePlan } from '../storage/schema'

const plan = (over: Partial<TradePlan> = {}) =>
  ({ ticker: '2330', market: 'TW', orderType: 'limit', entryPrice: 958.3, stopLoss: 884.6, shares: 1086, targets: [], status: 'draft', ...over }) as TradePlan

describe('ticks', () => {
  it('follows the TWSE table at each boundary', () => {
    expect(tickOf(9.99, 'TW', '2330')).toBe(0.01)
    expect(tickOf(10, 'TW', '2330')).toBe(0.05)
    expect(tickOf(50, 'TW', '2330')).toBe(0.1)
    expect(tickOf(100, 'TW', '2330')).toBe(0.5)
    expect(tickOf(500, 'TW', '2330')).toBe(1)
    expect(tickOf(1000, 'TW', '2330')).toBe(5)
    expect(tickOf(49.99, 'TW', '0050')).toBe(0.01)
    expect(tickOf(195, 'TW', '0050')).toBe(0.05)
    expect(tickOf(195, 'US', 'SPY')).toBe(0.01)
  })

  it('snaps buys down and stops up', () => {
    expect(snap(958.3, 'TW', '2330', 'down')).toBe(958)
    expect(snap(884.6, 'TW', '2330', 'up')).toBe(885)
    expect(snap(1052, 'TW', '2330', 'down')).toBe(1050)
    expect(snap(23.43, 'TW', '2317', 'down')).toBe(23.4)
    expect(snap(195.52, 'TW', '0050', 'up')).toBe(195.55)
    expect(snap(958, 'TW', '2330', 'down')).toBe(958)
  })
})

describe('costs', () => {
  it('charges the minimum fee and the right tax', () => {
    expect(fee(1000)).toBe(20)
    expect(fee(1_000_000)).toBe(1425)
    expect(fee(1_000_000, 0.28)).toBe(399)
    expect(sellTax(100_000, '2330')).toBe(300)
    expect(sellTax(100_000, '0050')).toBe(100)
    expect(fee(1_000_000, 1, 'US')).toBe(0)
  })

  it('splits board lots and odd lots', () => {
    expect(splitLots(1086)).toEqual({ lots: 1, odd: 86 })
    expect(splitLots(500)).toEqual({ lots: 0, odd: 500 })
  })
})

describe('orderTicket', () => {
  it('drafts the entry and the stop to set after the fill', () => {
    const t = orderTicket(plan())
    expect(t.lines.map((l) => l.text)).toEqual(['限價買進 2330 958，整股 1 張＋盤中零股 86 股，ROD', '觸價賣出 2330：跌到 885 時賣出全部 整股 1 張＋盤中零股 86 股'])
    expect(t.warnings[0]).toContain('改為 958')
    expect(t.costs!.lossAtStop).toBeGreaterThan((958 - 885) * 1086)
  })

  it('pairs the stop with the first target as OCO', () => {
    const t = orderTicket(plan({ status: 'open', targets: [{ price: 1600.4, fraction: 1 / 3 }], currentStop: 900 }))
    expect(t.lines).toHaveLength(1)
    expect(t.lines[0].text).toContain('二擇一單（OCO）：觸價賣出 900')
    expect(t.lines[0].text).toContain('限價賣出 1,600 盤中零股 362 股')
  })

  it('warns about a stop wider than the daily limit and a missing stop', () => {
    expect(orderTicket(plan({ stopLoss: 800 })).warnings.some((w) => w.includes('超過單日漲跌幅'))).toBe(true)
    expect(orderTicket(plan({ stopLoss: undefined })).warnings).toContain('還沒有停損：成交後沒有可以掛的停損單')
    expect(orderTicket(plan({ shares: 0 })).lines).toEqual([])
  })
})
