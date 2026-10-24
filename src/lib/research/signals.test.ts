import { describe, expect, it } from 'vitest'
import sample from './__fixtures__/finmind-sample.json'
import { createDefaultInvestmentPolicy, type StockThesis } from '../storage/schema'
import type { ThesisEvaluation } from '../calculations/thesisScoring'
import type { MacroAssessment } from '../calculations/macroRegime'
import { technicalSnapshot, type TechnicalSnapshot } from './technical'
import type { PriceRow } from './etfProfile'
import { batchShares, buildSignals, heldPositionOf, stopLossOf, type HeldPosition } from './signals'

const policy = createDefaultInvestmentPolicy()

describe('technicalSnapshot', () => {
  const rows = (sample as unknown as Record<string, Record<string, unknown[][]>>)['0050'].prices.map(
    ([date, open, max, min, close, money]) => ({ date, open, max, min, close, Trading_money: money }) as PriceRow,
  )

  it('reads 0050 through its 2025 split', () => {
    const t = technicalSnapshot(rows)!
    const last = rows[rows.length - 1]
    expect(t.date).toBe(last.date)
    expect(t.close).toBe(last.close)
    // Averages are on the post-split scale, near the current price.
    for (const v of [t.sma20, t.sma60, t.sma120, t.sma200]) expect(Math.abs(v! / t.close - 1)).toBeLessThan(0.3)
    expect(t.rsi14!).toBeGreaterThan(0)
    expect(t.rsi14!).toBeLessThan(100)
    expect(t.atr14!).toBeGreaterThan(0)
    expect(t.atr14! / t.close).toBeLessThan(0.1)
    expect(t.high55!).toBeGreaterThanOrEqual(t.low20! * 0.8)
    expect(t.ret12m).not.toBeNull()
  })

  it('needs at least 25 sessions', () => {
    expect(technicalSnapshot(rows.slice(-10))).toBeNull()
  })
})

function tech(overrides: Partial<TechnicalSnapshot> = {}): TechnicalSnapshot {
  return {
    date: '2026-10-23',
    close: 950,
    sma20: 960,
    sma60: 940,
    sma120: 900,
    sma200: 850,
    high55: 1000,
    low20: 920,
    rsi14: 50,
    atr14: 20,
    ret6m: 5,
    ret12m: 15,
    cross: null,
    ...overrides,
  }
}

function thesis(overrides: Partial<StockThesis> = {}, t: Partial<TechnicalSnapshot> = {}): StockThesis {
  return {
    id: 't1',
    ticker: '2330',
    name: '台積電',
    market: 'TW',
    kind: 'stock',
    fairValueBear: 700,
    fairValueBase: 1200,
    fairValueBull: 1600,
    currentPrice: 950,
    verdict: 'invest',
    auto: { stock: { redFlags: [] }, technical: tech({ close: overrides.currentPrice ?? 950, ...t }) },
    ...overrides,
  } as unknown as StockThesis
}

// Buy price 1000 (base 1200, 1/6 margin), position cap 8%.
const evaluation = { buyPrice: 1000, positionCapPercent: 8, targetPositionPercent: 6, rating: { overall: 'strong' } } as unknown as ThesisEvaluation
const macroOk = { stance: 'neutral', satelliteNewPositionsAllowed: true, actionNote: '' } as MacroAssessment
const macroBad = { stance: 'headwind', satelliteNewPositionsAllowed: false, actionNote: '' } as MacroAssessment

function run(th: StockThesis, opts: { macro?: MacroAssessment | null; holding?: HeldPosition | null; ev?: Partial<ThesisEvaluation> } = {}) {
  return buildSignals({
    thesis: th,
    evaluation: { ...evaluation, ...opts.ev },
    macro: opts.macro === undefined ? macroOk : opts.macro,
    holding: opts.holding ?? null,
    totalValueTwd: 10_000_000,
    policy,
  })
}

describe('stock entry rules', () => {
  it('buys the first batch in the buy zone and lists the ladder', () => {
    const r = run(thesis())
    expect(r.action).toBe('buy')
    expect(r.levels.map((l) => l.key)).toEqual(['exit', 'trim', 'batch1', 'batch2', 'stop', 'batch3'])
    const byKey = Object.fromEntries(r.levels.map((l) => [l.key, l]))
    expect(byKey.batch1.price).toBe(1000)
    expect(byKey.batch2.price).toBe(900)
    expect(byKey.batch3.price).toBe(700)
    expect(byKey.trim.price).toBe(1600)
    expect(byKey.exit.price).toBe(1920)
    expect(byKey.stop.price).toBe(900)
    expect(byKey.batch1.distancePercent).toBeCloseTo(5.3, 1)
    // Sorted from the highest price down.
    expect(r.levels.map((l) => l.price)).toEqual([...r.levels.map((l) => l.price)].sort((a, b) => b - a))
    expect(r.suggestedShares).toBeGreaterThan(0)
  })

  it('accelerates below the bear value', () => {
    expect(run(thesis({ currentPrice: 650 })).headline).toContain('加速')
  })

  it('only buys one batch while still breaking down', () => {
    const r = run(thesis({ currentPrice: 950 }, { sma20: 880, sma120: 990, low20: 960 }))
    expect(r.action).toBe('buy')
    expect(r.headline).toContain('只買第 1 批')
  })

  it('waits above the buy price, avoids above the bull value', () => {
    const wait = run(thesis({ currentPrice: 1100 }))
    expect(wait.action).toBe('wait')
    expect(wait.headline).toContain('9.1%')
    expect(run(thesis({ currentPrice: 1700 })).action).toBe('avoid')
  })

  it('follows the verdict and the macro stance', () => {
    expect(run(thesis({ verdict: 'pass' })).action).toBe('avoid')
    expect(run(thesis({ verdict: undefined })).action).toBe('wait')
    expect(run(thesis({ verdict: 'watch' })).headline).toContain('值得投資')
    const headwind = run(thesis(), { macro: macroBad })
    expect(headwind.action).toBe('wait')
    expect(headwind.signals.find((s) => s.key === 'macro')!.tone).toBe('bear')
  })
})

describe('held position rules', () => {
  const held = (avgCost: number, weightPercent = 3): HeldPosition => ({ shares: 1000, avgCost, weightPercent })

  it('exits, trims, adds and holds by price', () => {
    expect(run(thesis({ currentPrice: 2000 }), { holding: held(900) }).action).toBe('exit')
    expect(run(thesis({ currentPrice: 1650 }), { holding: held(900) }).action).toBe('trim')
    expect(run(thesis({ currentPrice: 950 }), { holding: held(900) }).action).toBe('add')
    expect(run(thesis({ currentPrice: 950 }), { holding: held(900, 8) }).action).toBe('hold')
    expect(run(thesis({ currentPrice: 1200 }), { holding: held(900) }).action).toBe('hold')
    expect(run(thesis({ verdict: 'pass' }), { holding: held(900) }).action).toBe('exit')
  })

  it('asks for a review on losses, red flags or a broken long trend', () => {
    const loss = run(thesis({ currentPrice: 700 }), { holding: held(1000) })
    expect(loss.action).toBe('review')
    expect(loss.reasons[0]).toContain('30.0%')
    const flagged = thesis({ auto: { stock: { redFlags: [{ key: 'receivables', label: '應收帳款暴增' }] }, technical: tech() } as never })
    expect(run(flagged, { holding: held(900) }).action).toBe('review')
    expect(run(thesis({}, { close: 800, sma200: 850, cross: 'death' }), { holding: held(900) }).action).toBe('review')
  })

  it('matches holdings by ticker', () => {
    const h = (ticker: string, shares: number, avgCost: number) =>
      ({ ticker, shares, avgCost, currentPrice: 1000, currency: 'TWD' }) as never
    const p = heldPositionOf('2330', [h('2330', 100, 800), h('2330.TW', 100, 1000), h('2317', 100, 1)], 1_000_000, 32)!
    expect(p.shares).toBe(200)
    expect(p.avgCost).toBe(900)
    expect(p.weightPercent).toBe(20)
    expect(heldPositionOf('0050', [], 1, 32)).toBeNull()
  })
})

describe('ETF rules', () => {
  const etf = (t: Partial<TechnicalSnapshot>, overrides: Partial<StockThesis> = {}) =>
    thesis({ kind: 'etf', fairValueBear: 0, fairValueBase: 0, fairValueBull: 0, currentPrice: 100, ...overrides }, { close: 100, ...t })

  it('enters with the trend and waits against it', () => {
    expect(run(etf({ sma120: 95, ret12m: 10 })).action).toBe('buy')
    expect(run(etf({ sma120: 105, ret12m: -5 })).action).toBe('wait')
    expect(run(etf({ sma120: 105, ret12m: -5 }), { holding: { shares: 1, avgCost: 90, weightPercent: 1 } }).action).toBe('review')
    expect(run(etf({ sma120: 95, ret12m: 10 }, { verdict: 'pass' })).action).toBe('avoid')
    const r = run(etf({ sma120: 95, ret12m: 10 }))
    expect(r.reasons[0]).toContain('定期定額')
    expect(r.suggestedShares).toBeNull()
    expect(r.levels.map((l) => l.key)).toEqual(['stop'])
  })
})

describe('sizing', () => {
  it('takes the smaller of the target share and the risk limit', () => {
    // Target 6% of 10M / 3 = 200,000 → 200 shares at 1000.
    expect(batchShares({ price: 1000, stop: null, targetPercent: 6, totalValueTwd: 10_000_000, policy })!.shares).toBe(200)
    // Risk: 10M × 30% × 1% = 30,000; 30,000 / 300 = 100 shares.
    const tight = batchShares({ price: 1000, stop: 700, targetPercent: 6, totalValueTwd: 10_000_000, policy })!
    expect(tight.shares).toBe(Math.floor((10_000_000 * policy.satellitePercent * policy.riskPerTradePercent) / 10_000 / 300))
    expect(tight.note).toContain('風險')
    expect(stopLossOf(tech({ close: 100, atr14: 4 }))).toBe(90)
  })
})

describe('tranches', () => {
  it('orders the batches by price when the bear value is above the buy price', () => {
    const r = run(thesis({ fairValueBear: 950, currentPrice: 1100 }))
    const batches = r.levels.filter((l) => l.key.startsWith('batch'))
    expect(batches.map((l) => l.price)).toEqual([1000, 950, 900])
    expect(batches[1].label).toContain('悲觀合理價')
  })
})
