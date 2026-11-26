import { describe, expect, it } from 'vitest'
import type { Bar } from '../market/priceHistory'
import type { PaperAccount, TradingStrategy } from '../storage/schema'
import { createDefaultInvestmentPolicy } from '../storage/schema'
import { symbolStatus } from '../backtest/engine'
import { adviceSummary, assistantItems, blocked, executionOf, explainItem, orderChecks, paperScanItems, paperShares, priceLevels, resolveItem, sleeveOf, stopWidth, weeklyReview, withSnapshot } from './assistant'

function weekdays(n: number, from = '2024-01-01'): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Closes along a path; a 2% daily range so ATR is about 2.
const series = (closes: number[]): Bar[] =>
  weekdays(closes.length).map((date, i) => ({ date, open: closes[i], high: closes[i] + 1, low: closes[i] - 1, close: closes[i], volume: 1000 }))

const flat = (n: number, v: number) => Array.from({ length: n }, () => v)
const policy = createDefaultInvestmentPolicy()

const strategy = (template: TradingStrategy['template'], params: Record<string, number>): TradingStrategy =>
  ({ id: 's', name: '卡', template, params, symbols: ['TW:1111'], edge: '', entryRules: '', exitRules: '', riskPerTradePercent: 1, status: 'paper', notes: '', createdAt: '', updatedAt: '' }) as TradingStrategy

function account(positions: PaperAccount['positions'] = [], cash = 1_000_000): PaperAccount {
  return { id: 'a', name: 'x', market: 'TW', initialCash: 1_000_000, cash, positions, orders: [], equityHistory: [], signalLog: [], createdAt: '' }
}

describe('symbolStatus', () => {
  it('explains entry, waiting and holding for a breakout card', () => {
    const params = { entryDays: 20, exitDays: 10, atrStop: 2 }
    const breakout = series([...flat(40, 100), 105])
    const waiting = series(flat(41, 100))
    const s = symbolStatus('donchian', params, { 'TW:1': breakout, 'TW:2': waiting, 'TW:3': [] }, {})
    expect(s.map((x) => x.state)).toEqual(['enter', 'wait', 'no_data'])
    expect(s[0].reading).toContain('突破前 20 日高點')
    expect(s[1].reading).toContain('還差')
    const held = symbolStatus('donchian', params, { 'TW:2': waiting }, { 'TW:2': { shares: 10, openedAt: '2024-01-10' } })
    expect(held[0].state).toBe('hold')
    expect(held[0].reading).toContain('出場線')
  })

  it('reports exits only for symbols held', () => {
    const params = { fast: 5, slow: 20, atrStop: 0 }
    const falling = series([...flat(30, 100), 95, 90, 85, 80, 75])
    expect(symbolStatus('ma_cross', params, { 'TW:1': falling }, {})[0].state).toBe('wait')
    expect(symbolStatus('ma_cross', params, { 'TW:1': falling }, { 'TW:1': { shares: 1, openedAt: '2024-01-02' } })[0].state).toBe('exit')
  })
})

describe('paperShares', () => {
  it('sizes by risk, then the regime multiplier and the caps', () => {
    // 1% of 1,000,000 = 10,000 risk; 5 per share → 2,000 shares.
    const risk = paperShares({ price: 100, stop: 95, equity: 1_000_000, cash: 1_000_000, policy, strategy: { riskPerTradePercent: 1 }, multiplier: 0.5 })
    expect(risk.shares).toBe(1000)
    // A tight stop asks for more than an equal slot allows.
    const capped = paperShares({ price: 100, stop: 99.5, equity: 1_000_000, cash: 1_000_000, policy, strategy: { riskPerTradePercent: 1 } })
    expect(capped.shares).toBe(Math.floor(1_000_000 / policy.maxOpenPositions / 100))
    expect(capped.basis.at(-1)).toContain('限制')
    expect(paperShares({ price: 100, stop: 95, equity: 1_000_000, cash: 50_000, policy }).shares).toBe(499)
  })
})

describe('assistantItems', () => {
  const params = { entryDays: 20, exitDays: 10, atrStop: 2 }
  const card = strategy('donchian', params)

  it('suggests a sized entry with an ATR stop', () => {
    const bars = series([...flat(40, 100), 105])
    const statuses = symbolStatus('donchian', params, { 'TW:1': bars }, {})
    const [item] = assistantItems({ strategy: card, account: account(), statuses, data: { 'TW:1': bars }, policy })
    expect(item.kind).toBe('enter')
    expect(item.stopLoss).toBeLessThan(105)
    expect(item.shares).toBeGreaterThan(0)
    expect(item.basis[0]).toContain('2 × ATR')
  })

  it('gives a card without a stop rule a protective stop that does not trail', () => {
    const noStop = strategy('ma_cross', { fast: 1, slow: 20, atrStop: 0 })
    expect(stopWidth(noStop)).toEqual({ k: 2.5, protective: true })
    const rising = series([...flat(30, 100), ...Array.from({ length: 20 }, (_, i) => 101 + i * 2)])
    const statuses = symbolStatus('ma_cross', noStop.params, { 'TW:1': rising }, { 'TW:1': { shares: 100, openedAt: rising[31].date } })
    const pos = { symbol: 'TW:1', name: '', shares: 100, avgCost: 103, lastPrice: 139, lastPriceDate: rising.at(-1)!.date, stopLoss: 98, openedAt: rising[31].date }
    const [item] = assistantItems({ strategy: noStop, account: account([pos]), statuses, data: { 'TW:1': rising }, policy })
    expect(item.kind).toBe('hold')
  })

  it('raises a trailing stop only upward and flags a missing stop', () => {
    const rising = series([...flat(30, 100), ...Array.from({ length: 20 }, (_, i) => 101 + i * 2)])
    const held = { 'TW:1': { shares: 100, openedAt: rising[31].date } }
    const statuses = symbolStatus('donchian', params, { 'TW:1': rising }, held)
    const pos = { symbol: 'TW:1', name: '', shares: 100, avgCost: 103, lastPrice: 139, lastPriceDate: rising.at(-1)!.date, stopLoss: 98, openedAt: rising[31].date }
    const [raise] = assistantItems({ strategy: card, account: account([pos]), statuses, data: { 'TW:1': rising }, policy })
    expect(raise.kind).toBe('raise_stop')
    expect(raise.raiseTo).toBeGreaterThan(98)
    const above = { ...pos, stopLoss: 200 }
    const [hit] = assistantItems({ strategy: card, account: account([above]), statuses, data: { 'TW:1': rising }, policy })
    expect(hit.kind).toBe('stop_hit')
    const [missing] = assistantItems({ strategy: card, account: account([{ ...pos, stopLoss: undefined }]), statuses, data: { 'TW:1': rising }, policy })
    expect(missing.kind).toBe('raise_stop')
  })
})

describe('orderChecks', () => {
  const base = { side: 'buy' as const, price: 100, shares: 1000, date: '2026-11-13', today: '2026-11-15', account: account(), policy, backtestPassed: false }

  it('blocks a buy without a stop, with too much risk or on stale prices', () => {
    expect(blocked(orderChecks({ ...base, stopLoss: 95 }))).toBe(false)
    expect(blocked(orderChecks(base))).toBe(true)
    expect(blocked(orderChecks({ ...base, stopLoss: 80 }))).toBe(true)
    expect(blocked(orderChecks({ ...base, stopLoss: 95, date: '2026-11-01' }))).toBe(true)
  })

  it('only advises on an unproven card', () => {
    const checks = orderChecks({ ...base, stopLoss: 95, strategy: strategy('donchian', {}) })
    expect(checks.find((c) => c.level === 'suggest')?.passed).toBe(false)
    expect(blocked(checks)).toBe(false)
  })
})

describe('snapshots and execution', () => {
  const item = (symbol: string, kind: 'enter' | 'hold', date: string) => ({ symbol, kind, date, close: 100, reading: '', basis: [], outcome: 'pending' as const })

  it('keeps outcomes on the same date and logs missed ones on a new date', () => {
    let a = withSnapshot(account(), [item('TW:1', 'enter', '2026-11-13'), item('TW:2', 'enter', '2026-11-13'), item('TW:3', 'hold', '2026-11-13')], 't1')
    a = resolveItem(a, 'TW:1', 'enter', 'followed')
    a = resolveItem(a, 'TW:2', 'enter', 'skipped', '怕追高')
    a = withSnapshot(a, [item('TW:1', 'enter', '2026-11-13')], 't2')
    expect(a.assistant?.items[0].outcome).toBe('followed')
    a = resolveItem(withSnapshot(account(), [item('TW:1', 'enter', '2026-11-13'), item('TW:2', 'enter', '2026-11-13')], 't1'), 'TW:2', 'enter', 'skipped', '怕追高')
    a = withSnapshot(a, [item('TW:1', 'enter', '2026-11-14')], 't3')
    expect(a.signalLog.map((i) => i.outcome)).toEqual(['missed', 'skipped'])
    const ex = executionOf(a)
    expect(ex.counts).toMatchObject({ missed: 1, skipped: 1, pending: 1 })
    expect(ex.rate).toBe(0)
    expect(ex.notes[0].note).toBe('怕追高')
  })
})

describe('paperScanItems', () => {
  it('lists pending suggestions, stops to raise and stale prices for paper cards only', () => {
    const card = strategy('donchian', {})
    const pos = { symbol: 'TW:1', name: '', shares: 100, avgCost: 100, lastPrice: 100, lastPriceDate: '2026-11-06', stopLoss: 95, openedAt: '2026-10-01' }
    const items = [
      { symbol: 'TW:1', kind: 'raise_stop' as const, date: '2026-11-13', close: 110, raiseTo: 101, reading: '', basis: [], outcome: 'pending' as const },
      { symbol: 'TW:2', kind: 'enter' as const, date: '2026-11-13', close: 50, reading: '', basis: [], outcome: 'pending' as const },
      { symbol: 'TW:3', kind: 'enter' as const, date: '2026-11-13', close: 50, reading: '', basis: [], outcome: 'skipped' as const },
    ]
    const a = { ...account([pos]), strategyId: 's', assistant: { date: '2026-11-13', generatedAt: '2026-11-13T07:00:00Z', items } }
    // 2026-11-16 is a Monday.
    const out = paperScanItems([a], [card], '2026-11-16')
    expect(out.map((i) => i.text)).toEqual([
      expect.stringContaining('停損上調到 101'),
      expect.stringContaining('1 筆建議待處理（進場 2）'),
      expect.stringContaining('持倉價格停在 2026-11-06'),
      expect.stringContaining('產生今日建議'),
    ])
    expect(out.every((i) => i.text.startsWith('虛擬・'))).toBe(true)
    expect(paperScanItems([{ ...a, name: '通道・虛擬' }], [card], '2026-11-16')[0].text).toMatch(/^通道・虛擬：/)
    expect(paperScanItems([a], [{ ...card, status: 'live' }], '2026-11-16')).toEqual([])
  })
})

describe('weeklyReview', () => {
  it('drafts the past week from suggestions and fills', () => {
    const log = (date: string, outcome: 'followed' | 'skipped' | 'missed', note?: string) => ({ symbol: 'TW:1', kind: 'enter' as const, date, close: 100, reading: '', basis: [], outcome, note })
    const fill = (filledAt: string, reason: string, rMultiple?: number) => ({ id: filledAt + reason, createdAt: filledAt, symbol: 'TW:1', name: '', side: 'sell' as const, type: 'market' as const, shares: 1, status: 'filled' as const, filledAt, reason, rMultiple })
    const a = {
      ...account(),
      signalLog: [log('2026-11-02', 'skipped', '太舊'), log('2026-11-10', 'followed'), log('2026-11-11', 'skipped', '怕追高'), log('2026-11-12', 'missed')],
      orders: [fill('2026-11-10T07:00:00Z', '策略訊號：…', 1.5), fill('2026-11-12T07:00:00Z', '停損觸發（自動）', -1), fill('2026-11-13T07:00:00Z', '想先獲利')],
    }
    const lines = weeklyReview(a, '2026-11-16')
    expect(lines[0]).toContain('照做 1、修改 0、略過 1、未處理 1')
    expect(lines.join('\n')).toContain('怕追高')
    expect(lines.join('\n')).not.toContain('太舊')
    expect(lines).toContain('成交 3 筆：依助手 1、停損觸發 1、手動 1')
    expect(lines).toContain('手動賣出 1：想先獲利')
    expect(lines.at(-1)).toBe('已實現 2 筆，平均 0.25R')
  })
})

describe('explainItem and adviceSummary', () => {
  const pos = { symbol: 'TW:1', name: '', shares: 100, avgCost: 100, lastPrice: 120, lastPriceDate: '2026-11-13', stopLoss: 95, openedAt: '2026-10-01' }
  const it0 = (kind: 'enter' | 'raise_stop' | 'hold' | 'wait', extra = {}) => ({ symbol: 'TW:1', kind, date: '2026-11-13', close: 120, reading: '', basis: [], outcome: 'pending' as const, ...extra })

  it('puts the action, money and risk first', () => {
    const e = explainItem(it0('enter', { shares: 1000, stopLoss: 110 }), account())
    expect(e.action).toBe('買進 1 1,000 股，約 120,000 元')
    expect(e.numbers.map((n) => n.label)).toEqual(['停損', '停損時虧損', '部位'])
    expect(e.numbers[1].value).toContain('10,000 元')
    const r = explainItem(it0('raise_stop', { raiseTo: 108 }), account([pos]))
    expect(r.action).toBe('把 1 的停損從 95 上調到 108')
    expect(r.numbers[1]).toEqual({ label: '停損時鎖住獲利', value: '800 元' })
  })

  it('sums up the day', () => {
    expect(adviceSummary([it0('hold'), it0('wait')]).headline).toBe('今天沒有要下單或調整的事')
    const s = adviceSummary([it0('enter'), it0('raise_stop'), { ...it0('enter'), outcome: 'followed' as const }, it0('wait')])
    expect(s.headline).toBe('今天有 2 件事要處理（進場 2、上調停損 1）')
    expect(s.detail).toContain('觀望 1')
  })
})

describe('weekly paper cards', () => {
  const card = { ...strategy('weekly_breakout', {}), cadence: 'weekly' as const }
  const snap = (generatedAt: string) => ({ ...account(), strategyId: 's', assistant: { date: generatedAt.slice(0, 10), generatedAt, items: [] } })

  it('reminds once on the decision day, then only the stops', () => {
    // 2026-11-20 is a Friday; generated last Friday.
    const fri = paperScanItems([snap('2026-11-13T10:00:00Z')], [card], '2026-11-20')
    expect(fri.map((i) => i.text)).toEqual([expect.stringContaining('週五收盤後產生本週建議')])
    // Saturday, not done yet: still due.
    expect(paperScanItems([snap('2026-11-13T10:00:00Z')], [card], '2026-11-21')).toHaveLength(1)
    // Done on Friday: Monday asks nothing without positions.
    expect(paperScanItems([snap('2026-11-20T10:00:00Z')], [card], '2026-11-23')).toEqual([])
    // A card's own decision day wins.
    const wed = paperScanItems([snap('2026-11-13T10:00:00Z')], [{ ...card, decisionDay: 3 }], '2026-11-18')
    expect(wed[0].text).toContain('週三')
  })

  it('says when the week decides', () => {
    const s = adviceSummary([{ symbol: 'TW:1', kind: 'wait', date: '2026-11-18', close: 1, reading: '', basis: [], outcome: 'pending', decidesOn: '2026-11-20' }])
    expect(s.detail).toContain('11/20 收盤判斷')
  })
})

describe('priceLevels', () => {
  const base = { symbol: 'TW:2330', date: '2026-11-25', close: 1000, reading: '', basis: [], outcome: 'pending' as const }
  it('shows the entry price and the stop an entry would get while waiting', () => {
    const lv = priceLevels({ ...base, kind: 'wait', levels: { entry: { above: 1050 }, exit: { below: 940 } }, stopEstimate: 920 }, account())
    expect(lv.entry).toBe('收盤 > 1050（+5.0%）')
    expect(lv.exit).toBe('買進後停損約 920（−8.0%）・持有後：收盤 < 940（−6.0%）')
    // The exit line equal to the entry price (a cross back) is not repeated.
    const cross = priceLevels({ ...base, kind: 'wait', levels: { entry: { above: 1050 }, exit: { below: 1050 } }, stopEstimate: 920 }, account())
    expect(cross.exit).toBe('買進後停損約 920（−8.0%）')
  })
  it('shows a zone, notes, the weekly decision day and the position’s stop', () => {
    const zone = priceLevels({ ...base, kind: 'wait', decidesOn: '2026-11-28', levels: { entry: { above: 950, below: 980 } } }, account())
    expect(zone.entry).toBe('11/28 收盤介於 950～980（−5.0%～−2.0%）')
    const held = account([{ symbol: 'TW:2330', name: '', shares: 10, avgCost: 900, lastPrice: 1000, lastPriceDate: '2026-11-25', stopLoss: 930, openedAt: '2026-10-01' }])
    const lv = priceLevels({ ...base, kind: 'hold', levels: { exit: { above: 1100, note: '或持有滿 10 個交易日（還有 3 天）' } } }, held)
    expect(lv.entry).toBe('已持有')
    expect(lv.exit).toBe('收盤 > 1100（+10.0%），或持有滿 10 個交易日（還有 3 天）・停損 930（−7.0%）')
  })
})

describe('the trading capital (all paper accounts)', () => {
  const pos = (shares: number, price: number, stop?: number) => ({ symbol: `TW:${shares}`, name: '', shares, avgCost: price, lastPrice: price, lastPriceDate: '2026-11-25', stopLoss: stop, openedAt: '2026-11-01' })
  const other = (id: string, cash: number, positions: PaperAccount['positions'] = [], market: PaperAccount['market'] = 'TW'): PaperAccount => ({ ...account(positions, cash), id, market })

  it('adds up every account of the market, and their open stop risk', () => {
    const s = sleeveOf([account(), other('b', 500_000, [pos(1000, 100, 90)]), other('u', 9_999, [], 'US'), other('c', 0, [pos(10, 50)])], 'TW')
    expect(s.capital).toBe(1_000_000 + 500_000 + 100_000 + 500)
    expect(s.openRisk).toBe(10_000)
    expect(s.unstopped).toBe(1)
  })

  it('sizes on the total, within this account’s cash, and stops at 6% open risk', () => {
    // 1% of 3,000,000 = 30,000; 5 per share → 6,000 shares, but the cash is 200,000.
    const total = paperShares({ price: 100, stop: 95, equity: 3_000_000, cash: 200_000, policy })
    expect(total.shares).toBe(Math.floor(200_000 / 100.2))
    const roomy = paperShares({ price: 100, stop: 80, equity: 3_000_000, cash: 3_000_000, policy, strategy: { riskPerTradePercent: 1 } })
    expect(roomy.shares).toBe(1500)
    // 5.5% open: only 0.5% = 15,000 left → 750 shares.
    const near = paperShares({ price: 100, stop: 80, equity: 3_000_000, cash: 3_000_000, openRisk: 165_000, policy })
    expect(near.shares).toBe(750)
    expect(near.basis.join('')).toContain('上限 6%')
    expect(paperShares({ price: 100, stop: 80, equity: 3_000_000, cash: 3_000_000, openRisk: 180_000, policy }).shares).toBe(0)
  })

  it('checks a manual order against the total and the open-risk limit', () => {
    const base = { side: 'buy' as const, price: 100, date: '2026-11-25', today: '2026-11-25', policy, backtestPassed: false, stopLoss: 90 }
    const small = account([], 1_000_000)
    // 2,000 shares × 10 = 20,000: 2% of one account, 1% of two.
    expect(blocked(orderChecks({ ...base, shares: 2000, account: small }))).toBe(true)
    expect(orderChecks({ ...base, shares: 2000, account: small, accounts: [small, other('b', 1_000_000)] }).filter((c) => c.level === 'required' && !c.passed).map((c) => c.text)).toEqual([])
    // The other account risks 120,000 of 2,200,000 (5.5%); 15,000 more passes 6%.
    const risky = other('b', 0, [pos(12_000, 100, 90)])
    const checks = orderChecks({ ...base, shares: 1500, account: small, accounts: [small, risky] })
    expect(checks.find((c) => c.text.includes('未平倉'))?.passed).toBe(false)
  })
})
