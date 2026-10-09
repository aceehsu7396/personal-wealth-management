import { describe, expect, it } from 'vitest'
import {
  applyTradeToHoldings,
  buildPreTradeChecklist,
  type ChecklistContext,
  type PendingTrade,
} from './preTradeChecklist'
import type { MacroAssessment } from './macroRegime'
import {
  createDefaultInvestmentPolicy,
  type Holding,
  type StockThesis,
} from '../storage/schema'

const policy = createDefaultInvestmentPolicy()

const thesis: StockThesis = {
  id: 'th1',
  ticker: '2330',
  name: '台積電',
  market: 'TW',
  sector: '半導體',
  lynchCategory: 'stalwart',
  inCircleOfCompetence: true,
  status: 'watch',
  thesis: 'a',
  drivers: 'b',
  killCriteria: 'c',
  sources: 'd',
  preMortem: 'e',
  fiveForces: { rivalry: 4, newEntrants: 4, substitutes: 4, buyerPower: 3, supplierPower: 3 },
  powers: {
    scaleEconomies: 5,
    networkEconomies: 0,
    counterPositioning: 0,
    switchingCosts: 4,
    branding: 0,
    corneredResource: 0,
    processPower: 5,
  },
  fScore: 8,
  hasUnexplainedRedFlags: false,
  fairValueBear: 700,
  fairValueBase: 1200,
  fairValueBull: 1600,
  currentPrice: 1000,
  updatedAt: '',
  createdAt: '',
}

const core: Holding = {
  id: 'core',
  ticker: '0050',
  name: '',
  sleeve: 'core_tw',
  currency: 'TWD',
  shares: 1000,
  avgCost: 100,
  currentPrice: 100,
  createdAt: '',
}

const allowingMacro = { satelliteNewPositionsAllowed: true } as MacroAssessment

function ctx(overrides: Partial<ChecklistContext> = {}): ChecklistContext {
  return {
    holdings: [core],
    theses: [thesis],
    policy,
    guardrails: { rebalancingBandPercent: 50, maxTiltPercent: 10, minEquityFloorPercent: 30, reviewCadenceMonths: 3 },
    meta: { fxUsdTwd: 30, peakValueTwd: 0, peakDate: null },
    macro: allowingMacro,
    ...overrides,
  }
}

const buy: PendingTrade = {
  side: 'buy',
  reason: 'tranche_1',
  ticker: '2330',
  name: '台積電',
  sleeve: 'satellite_tw',
  currency: 'TWD',
  shares: 4,
  price: 1000,
  thesisId: 'th1',
  biasNotes: '找過反方觀點',
}

describe('applyTradeToHoldings', () => {
  it('averages a buy into the existing cost basis', () => {
    const [h] = applyTradeToHoldings([core], { ...buy, holdingId: 'core', shares: 1000, price: 200 })
    expect(h.shares).toBe(2000)
    expect(h.avgCost).toBe(150)
  })

  it('never sells below zero shares', () => {
    const [h] = applyTradeToHoldings([core], { ...buy, side: 'sell', holdingId: 'core', shares: 5000 })
    expect(h.shares).toBe(0)
  })

  it('creates a holding for a buy of a new ticker', () => {
    const result = applyTradeToHoldings([core], buy)
    expect(result).toHaveLength(2)
    expect(result[1].sleeve).toBe('satellite_tw')
  })
})

describe('buildPreTradeChecklist', () => {
  it('passes a disciplined satellite buy', () => {
    const items = buildPreTradeChecklist(buy, ctx(), {})
    expect(items.filter((i) => !i.passed)).toEqual([])
  })

  it('evaluates the research card at the trade price', () => {
    const items = buildPreTradeChecklist({ ...buy, price: 1100 }, ctx(), {})
    expect(items.find((i) => i.key === 'thesis.price')?.passed).toBe(false)
  })

  it('blocks satellite buys when macro is a headwind or missing', () => {
    const blocked = buildPreTradeChecklist(buy, ctx({ macro: { satelliteNewPositionsAllowed: false } as MacroAssessment }), {})
    expect(blocked.find((i) => i.key === 'macro')?.passed).toBe(false)
    const missing = buildPreTradeChecklist(buy, ctx({ macro: null }), {})
    expect(missing.find((i) => i.key === 'macro')?.passed).toBe(false)
  })

  it('flags satellite buys before the action roadmap is unlocked', () => {
    const locked = buildPreTradeChecklist(
      buy,
      ctx({ satelliteGate: { unlocked: false, missingSteps: ['1.2 準備緊急預備金'] } }),
      {},
    )
    const gate = locked.find((i) => i.key === 'journeyUnlocked')!
    expect(gate.passed).toBe(false)
    expect(gate.label).toContain('1.2 準備緊急預備金')
    const open = buildPreTradeChecklist(buy, ctx({ satelliteGate: { unlocked: true, missingSteps: [] } }), {})
    expect(open.find((i) => i.key === 'journeyUnlocked')?.passed).toBe(true)
  })

  it('does not gate core DCA buys', () => {
    const items = buildPreTradeChecklist(
      { ...buy, reason: 'core_dca', sleeve: 'core_tw', holdingId: 'core', thesisId: undefined },
      ctx({ satelliteGate: { unlocked: false, missingSteps: ['x'] } }),
      {},
    )
    expect(items.find((i) => i.key === 'journeyUnlocked')).toBeUndefined()
  })

  it('skips stock checks when buying more of an active fund', () => {
    const fund: Holding = { ...core, id: 'fund', ticker: 'F1', kind: 'fund', sleeve: 'satellite_fund', shares: 10, currentPrice: 10 }
    const items = buildPreTradeChecklist(
      { ...buy, holdingId: 'fund', sleeve: 'satellite_fund', thesisId: undefined, shares: 50, price: 10 },
      ctx({ holdings: [core, fund], satelliteGate: { unlocked: true, missingSteps: [] } }),
      {},
    )
    const keys = items.map((i) => i.key)
    expect(keys).toEqual(expect.arrayContaining(['journeyUnlocked', 'satelliteCap', 'macro', 'bias']))
    expect(keys.some((k) => k === 'thesisLinked' || k.startsWith('thesis.') || k === 'positionCap' || k === 'sectorCap')).toBe(false)
    expect(items.filter((i) => !i.passed)).toEqual([])
  })

  it('flags a buy that breaches the single-position cap', () => {
    const items = buildPreTradeChecklist({ ...buy, shares: 20 }, ctx(), {})
    expect(items.find((i) => i.key === 'positionCap')?.passed).toBe(false)
  })

  it('requires the bias questions for satellite buys', () => {
    const items = buildPreTradeChecklist({ ...buy, biasNotes: ' ' }, ctx(), {})
    expect(items.find((i) => i.key === 'bias')?.passed).toBe(false)
  })

  it('keeps core DCA buys light', () => {
    const items = buildPreTradeChecklist(
      { ...buy, reason: 'core_dca', sleeve: 'core_tw', holdingId: 'core', thesisId: undefined, biasNotes: '' },
      ctx(),
      {},
    )
    expect(items).toEqual([])
  })

  it('checks the USD cap only for USD purchases', () => {
    const vt: Holding = { ...core, id: 'vt', ticker: 'VT', sleeve: 'core_global', currency: 'USD', shares: 1000, currentPrice: 10 }
    const overCap = ctx({ holdings: [core, vt] })
    const twdBuy = buildPreTradeChecklist(buy, overCap, {})
    expect(twdBuy.find((i) => i.key === 'usdCap')).toBeUndefined()
    const usdBuy = buildPreTradeChecklist(
      { ...buy, reason: 'core_dca', sleeve: 'core_global', currency: 'USD', holdingId: 'vt', thesisId: undefined },
      overCap,
      {},
    )
    expect(usdBuy.find((i) => i.key === 'usdCap')?.passed).toBe(false)
  })

  it('verifies the overvaluation exit against the research card', () => {
    const held: Holding = { ...core, id: 'sat', sleeve: 'satellite_tw', shares: 10, avgCost: 900, currentPrice: 1000, thesisId: 'th1' }
    const sell: PendingTrade = { ...buy, side: 'sell', reason: 'exit_overvalued', holdingId: 'sat', shares: 5, price: 1700 }
    const answers = { notPriceNoise: true, costsConsidered: true }
    const items = buildPreTradeChecklist(sell, ctx({ holdings: [core, held] }), answers)
    expect(items.filter((i) => !i.passed)).toEqual([])

    const tooEarly = buildPreTradeChecklist({ ...sell, price: 1300 }, ctx({ holdings: [core, held] }), answers)
    expect(tooEarly.find((i) => i.key === 'overvalued')?.passed).toBe(false)
  })

  it('records manual confirmations for a thesis-broken exit', () => {
    const held: Holding = { ...core, id: 'sat', sleeve: 'satellite_tw', shares: 10, thesisId: 'th1' }
    const sell: PendingTrade = { ...buy, side: 'sell', reason: 'exit_thesis_broken', holdingId: 'sat', shares: 10 }
    const items = buildPreTradeChecklist(sell, ctx({ holdings: [core, held] }), { killTriggered: true })
    expect(items.find((i) => i.key === 'killTriggered')).toMatchObject({ passed: true, manual: true })
    expect(items.find((i) => i.key === 'notPriceNoise')?.passed).toBe(false)
  })
})
