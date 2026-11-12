import { describe, expect, it } from 'vitest'
import {
  executionStats,
  planAdvice,
  planFromStrategy,
  planFromThesis,
  positionScanItems,
  positionStatus,
  sharesByRisk,
  sizeOptions,
  sortScan,
  scanItem,
  trailingStop,
  type PlanDraft,
} from './tradePlan'
import type { SignalReport } from '../research/signals'
import type { ChecklistContext } from '../calculations/preTradeChecklist'
import type { MacroAssessment } from '../calculations/macroRegime'
import { rowOf, type RegimeContext } from '../market/regime'
import { createDefaultInvestmentPolicy, createDefaultRegimeParams, type StockThesis, type Trade, type TradePlan, type TradingStrategy } from '../storage/schema'
import type { Bar } from '../market/priceHistory'

const policy = createDefaultInvestmentPolicy()

const thesis = {
  id: 'th',
  ticker: '2330',
  name: '台積電',
  market: 'TW',
  kind: 'stock',
  verdict: 'invest',
  killCriteria: '連兩季營收衰退',
  currentPrice: 958,
  updatedAt: '2026-11-01T00:00:00Z',
} as StockThesis

const report = (over: Partial<SignalReport> = {}): SignalReport => ({
  action: 'buy',
  headline: '進入買進區（≤ 960），買進第 1 批',
  reasons: [],
  levels: [
    { key: 'exit', label: '', price: 1920, distancePercent: 0 },
    { key: 'trim', label: '', price: 1600, distancePercent: 0 },
    { key: 'batch1', label: '', price: 960, distancePercent: 0 },
    { key: 'batch2', label: '', price: 864, distancePercent: 0 },
    { key: 'stop', label: '', price: 885, distancePercent: 0 },
  ],
  signals: [],
  stopLoss: 885,
  suggestedShares: 173,
  sizingNote: '目標部位 5% 的三分之一',
  held: false,
  heldShares: null,
  asOf: null,
  ...over,
})

const regimeOf = (regime: RegimeContext['regime'], over: Partial<RegimeContext> = {}): RegimeContext => {
  const row = rowOf(createDefaultRegimeParams(), regime)
  return {
    regime,
    label: regime,
    since: '2026-10-01',
    pending: null,
    changedRecently: false,
    row,
    multiplier: row.sizeMultiplier,
    macroHalved: false,
    macroHeadwind: false,
    coolingOff: false,
    basis: `局勢參數：${regime}`,
    ...over,
  }
}

const ctx: ChecklistContext = {
  holdings: [],
  theses: [],
  policy,
  guardrails: { rebalancingBandPercent: 50, maxTiltPercent: 10, minEquityFloorPercent: 30, reviewCadenceMonths: 3 },
  meta: { fxUsdTwd: 30, peakValueTwd: 0, peakDate: null },
  macro: { satelliteNewPositionsAllowed: true } as MacroAssessment,
  regime: regimeOf('bull'),
}

const bar = (date: string, close: number, high = close, low = close): Bar => ({ date, open: close, high, low, close, volume: 1 })

const openPlan = (over: Partial<TradePlan> = {}): TradePlan => ({
  ...planFromThesis(thesis, report(), policy),
  id: 'p',
  status: 'open',
  entryPrice: 960,
  stopLoss: 885,
  currentStop: 885,
  openedAt: '2026-10-01',
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('drafts', () => {
  it('drafts a value-batch plan from a research card', () => {
    const plan = planFromThesis(thesis, report(), policy)
    expect(plan).toMatchObject({
      source: 'thesis',
      thesisId: 'th',
      entryMethod: 'value_batches',
      entryPrice: 958,
      stopLoss: 885,
      stopMethod: 'atr',
      shares: 173,
      thesisExit: '連兩季營收衰退',
    })
    expect(plan.targets).toEqual([
      { price: 1600, fraction: 1 / 3 },
      { price: 1920, fraction: 1 },
    ])
    expect(plan.trigger).toContain('960')
    expect(plan.rules.some((r) => r.startsWith('投資政策：每筆停損風險'))).toBe(true)
  })

  it('drafts a strategy plan with an ATR stop, risk-based shares and a chandelier exit', () => {
    const strategy = {
      id: 's',
      name: '均線趨勢',
      template: 'ma_cross',
      params: { atrStop: 3 },
      symbols: ['TW:2330'],
      entryRules: '',
      exitRules: '',
      riskPerTradePercent: 1,
    } as unknown as TradingStrategy
    const plan = planFromStrategy(strategy, { close: 1000, atr: 30 }, 10_000_000, policy)
    expect(plan).toMatchObject({ source: 'strategy', ticker: '2330', entryMethod: 'breakout', stopLoss: 910, trailing: 'chandelier', trailingParam: 3 })
    expect(plan.shares).toBe(sharesByRisk(1000, 910, 10_000_000, policy, 1))
  })
})

describe('position size', () => {
  it('takes the most conservative method, then the regime multiplier and the cap', () => {
    // Total 10M, trading sleeve 3M. Risk: 30k ÷ 100 = 300 shares. Volatility:
    // 3M × (15 ÷ 30) ÷ 8 = 187,500 ÷ 1000 = 187 shares. Kelly: p 0.5, payoff 2
    // → 25%, quarter → 6.25% × 3M = 187,500 → 187 shares.
    const r = sizeOptions({ price: 1000, stop: 900, totalValueTwd: 10_000_000, policy, annualVolPercent: 30, backtest: { winRate: 0.5, profitFactor: 2 }, multiplier: 0.5 })
    expect(r.options.map((o) => o.shares)).toEqual([300, 187, 187])
    expect(r.chosen).toBe('volatility')
    expect(r.shares).toBe(93)
    const capped = sizeOptions({ price: 100, stop: 99, totalValueTwd: 10_000_000, policy })
    expect(capped.shares).toBe(capped.capShares)
    expect(sizeOptions({ price: 1000, totalValueTwd: 1e7, policy }).shares).toBeNull()
  })
})

describe('regime parameters', () => {
  it('scales a draft by the regime and records the snapshot', () => {
    const plan = planFromThesis(thesis, report(), policy, regimeOf('correction'))
    expect(plan.shares).toBe(86)
    expect(plan.regimeMultiplier).toBe(0.5)
    expect(plan.rules.at(-1)).toContain('局勢參數')
  })

  it('uses the row stop width for a strategy draft', () => {
    const strategy = { id: 's', name: '均線', template: 'ma_cross', params: { atrStop: 3 }, symbols: ['TW:2330'], entryRules: '', exitRules: '', riskPerTradePercent: 1 } as unknown as TradingStrategy
    const plan = planFromStrategy(strategy, { close: 1000, atr: 30 }, 10_000_000, policy, regimeOf('overheated'))
    expect(plan.stopLoss).toBe(940)
    expect(plan.trailingParam).toBe(2)
  })

  it('requires an allowed entry method and a size within the regime cap', () => {
    const required = (r: RegimeContext, shares = 86) =>
      planAdvice({ ...planFromThesis(thesis, report(), policy), shares }, { ctx: { ...ctx, regime: r }, report: report(), today: '2026-11-12' })
        .filter((a) => a.level === 'required')
        .map((a) => a.text)
    expect(required(regimeOf('range')).some((t) => t.includes('不允許'))).toBe(true)
    expect(required(regimeOf('correction'), 173).some((t) => t.includes('超過局勢上限 86'))).toBe(true)
    expect(required(regimeOf('correction')).filter((t) => /局勢|不允許|暫停/.test(t))).toEqual([])
    expect(required(regimeOf('crash')).some((t) => t.includes('暫停新建倉'))).toBe(true)
  })
})

describe('three-level advice', () => {
  const base = (over: Partial<PlanDraft>): PlanDraft => ({ ...planFromThesis(thesis, report(), policy), ...over })

  it('requires a stop below the entry, and a size', () => {
    const levels = (p: PlanDraft) => planAdvice(p, { ctx, today: '2026-11-12' }).filter((a) => a.level === 'required').map((a) => a.text)
    expect(levels(base({ stopLoss: undefined }))).toContain('還沒有設停損')
    expect(levels(base({ stopLoss: 990 })).some((t) => t.includes('必須低於進場價'))).toBe(true)
    expect(levels(base({ shares: undefined }))).toContain('還沒有填進場價與股數')
  })

  it('suggests and reminds with their basis', () => {
    const items = planAdvice(base({ shares: 300, targets: [{ price: 1050, fraction: 1 }] }), { ctx, report: report(), today: '2026-11-12' })
    expect(items.find((a) => a.text.includes('超過建議'))?.level).toBe('suggest')
    expect(items.find((a) => a.text.includes('風報比'))?.level).toBe('suggest')
    expect(items.find((a) => a.text.includes('第 2 批在 864'))?.level).toBe('notice')
    expect(items.every((a) => a.basis.length > 0)).toBe(true)
  })

  it('flags a research card not updated for four months', () => {
    const stale = { ...thesis, updatedAt: '2026-06-01T00:00:00Z' }
    const items = planAdvice(base({}), { ctx, thesis: stale, today: '2026-11-12' })
    expect(items.some((a) => a.text.includes('超過 4 個月'))).toBe(true)
  })
})

describe('open positions', () => {
  // 30 rising bars with a 40-point range: ATR settles near 40.
  const bars = Array.from({ length: 30 }, (_, i) => bar(`2026-10-${String(i + 1).padStart(2, '0')}`, 1000 + i * 5, 1020 + i * 5, 980 + i * 5))

  it('moves a chandelier stop up only', () => {
    const plan = openPlan({ trailing: 'chandelier', trailingParam: 2.5 })
    const up = trailingStop(plan, bars)
    expect(up).not.toBeNull()
    expect(up!).toBeGreaterThan(885)
    expect(trailingStop({ ...plan, currentStop: 5000 }, bars)).toBeNull()
  })

  it('reads R, stop hits, targets and time stops', () => {
    const plan = openPlan({ trailing: 'none', timeStopDays: 20 })
    const up = positionStatus(plan, [bar('2026-10-31', 1110)])!
    expect(up.rMultiple).toBe(2)
    expect(up.flags).toEqual(['ok'])
    const hit = positionStatus(plan, [bar('2026-10-31', 880)])!
    expect(hit.flags).toContain('stop_hit')
    expect(hit.flags).toContain('time_stop')
    const target = positionStatus(plan, [bar('2026-10-31', 1650)])!
    expect(target.reachedTarget).toEqual({ price: 1600, fraction: 1 / 3 })
    expect(target.nextTarget).toEqual({ price: 1920, fraction: 1 })
  })

  it('orders the day by discipline: stops before buys', () => {
    const plan = openPlan({ trailing: 'none' })
    const items = positionScanItems(plan, positionStatus(plan, [bar('2026-10-31', 880)])!)
    const all = sortScan([scanItem('buy_zone', '買點', '研究卡', '/'), ...items, scanItem('review_due', '檢討', '日誌', '/')])
    expect(all.map((i) => i.priority)).toEqual([1, 8, 9])
    expect(all[0].level).toBe('required')
    expect(all[1].level).toBe('suggest')
    expect(all[2].level).toBe('notice')
  })
})

describe('execution quality', () => {
  it('measures slippage against the plan and late stop exits', () => {
    const plan = openPlan({ entryPrice: 1000, currentStop: 900 })
    const trade = (over: Partial<Trade>) => ({ id: 't', date: '', ticker: '2330', name: '', side: 'buy', reason: 'tranche_1', shares: 1, price: 1000, currency: 'TWD', ...over }) as Trade
    const stats = executionStats([plan], [
      trade({ planId: 'p', price: 1010 }),
      trade({ reason: 'strategy_entry' }),
      trade({ side: 'sell', reason: 'stop_loss', planId: 'p', price: 870 }),
    ])
    expect(stats).toMatchObject({ planned: 1, satelliteBuys: 2, lateStops: 1 })
    expect(stats.avgSlippage).toBeCloseTo(0.01)
  })
})
