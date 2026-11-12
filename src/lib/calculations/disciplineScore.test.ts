import { describe, expect, it } from 'vitest'
import { addMonths, computeDiscipline, reviewsDue, tierOf } from './disciplineScore'
import { createDefaultInvestmentPolicy, type Trade } from '../storage/schema'

const policy = createDefaultInvestmentPolicy()

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: Math.random().toString(),
    date: '2026-01-15',
    ticker: '2330',
    name: '',
    side: 'buy',
    reason: 'tranche_1',
    shares: 1,
    price: 1,
    currency: 'TWD',
    checklist: [{ key: 'a', label: 'a', passed: true }],
    emotion: 3,
    biasNotes: '',
    createdAt: '',
    ...overrides,
  }
}

const review = { reviewedAt: '2026-08-01', outcomeNote: '', decisionQuality: 4, lesson: '' }

describe('addMonths', () => {
  it('adds calendar months without timezone drift and clamps month-end', () => {
    expect(addMonths('2026-01-15', 6)).toBe('2026-07-15')
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28')
    expect(addMonths('2026-11-30', 12)).toBe('2027-11-30')
  })
})

describe('reviewsDue', () => {
  it('lists 6- and 12-month reviews once their date has passed', () => {
    const { due } = reviewsDue([trade()], '2027-02-01')
    expect(due.map((d) => d.slot)).toEqual(['review6m', 'review12m'])
    expect(due[0].dueDate).toBe('2026-07-15')
  })

  it('skips core DCA trades and counts completed reviews', () => {
    const { due, done } = reviewsDue(
      [trade({ reason: 'core_dca' }), trade({ review6m: review })],
      '2026-10-01',
    )
    expect(due).toHaveLength(0)
    expect(done).toBe(1)
  })
})

describe('computeDiscipline', () => {
  it('returns no score without any data', () => {
    const result = computeDiscipline([], [], [], policy, '2026-10-01')
    expect(result.score).toBeNull()
    expect(result.tier).toBe('尚無資料')
  })

  it('weights compliance and review completion when no satellite is held', () => {
    const trades = [
      trade({ review6m: review }),
      trade({ checklist: [{ key: 'a', label: 'a', passed: false }], exceptionReason: 'x' }),
    ]
    const result = computeDiscipline(trades, [], [], policy, '2026-10-01')
    expect(result.complianceRate).toBe(50)
    expect(result.reviewCompletionRate).toBe(50)
    expect(result.score).toBe(50)
    expect(result.exceptionTrades).toHaveLength(1)
    expect(result.pendingReviews).toHaveLength(1)
  })

  it('takes 5 points per late stop-loss exit on a plan, at most 20', () => {
    const plan = { id: 'p', stopLoss: 900, currentStop: 950 }
    const onTime = trade({ side: 'sell', reason: 'stop_loss', planId: 'p', price: 945 })
    const late = trade({ side: 'sell', reason: 'stop_loss', planId: 'p', price: 920 })
    const base = computeDiscipline([onTime], [], [], policy, '', [plan]).score!
    expect(computeDiscipline([onTime, late], [], [], policy, '', [plan])).toMatchObject({ lateStops: 1, score: base - 5 })
    const many = Array.from({ length: 6 }, () => late)
    expect(computeDiscipline(many, [], [], policy, '', [plan]).score).toBe(base - 20)
  })
})

describe('execution penalties', () => {
  const buy = (price: number, planId = 'p') => trade({ side: 'buy', reason: 'tranche_1', planId, price })
  const plan = (over: object = {}) => ({ id: 'p', stopLoss: 900, currentStop: 900, entryPrice: 1000, status: 'open' as const, advice: [], ...over })

  it('takes 5 points above 0.5% average slippage and 10 above 1%', () => {
    const base = computeDiscipline([buy(1000)], [], [], policy, '', [plan()])
    expect(base.penalties.slippage).toBe(0)
    expect(computeDiscipline([buy(1007)], [], [], policy, '', [plan()])).toMatchObject({ penalties: { slippage: 5 }, score: base.score! - 5 })
    expect(computeDiscipline([buy(1020)], [], [], policy, '', [plan()]).penalties.slippage).toBe(10)
  })

  it('measures a later batch against its own price', () => {
    const batches = [
      { kind: 'batch' as const, price: 1000, shares: 1, addedAt: '', filledAt: '2026-01-01', fillPrice: 1000 },
      { kind: 'batch' as const, price: 900, shares: 1, addedAt: '', filledAt: '2026-02-01', fillPrice: 901 },
    ]
    const r = computeDiscipline([buy(1000), { ...buy(901), date: '2026-02-01' }], [], [], policy, '', [plan({ batches })])
    expect(r.avgSlippage).toBeCloseTo(0.000556, 5)
  })

  it('takes 3 points per declined required item on executed plans, at most 15, not twice', () => {
    const declined = { level: 'required' as const, text: 'x', basis: '', decision: 'declined' as const, reason: 'r' }
    const base = computeDiscipline([buy(1000)], [], [], policy, '', [plan()]).score!
    expect(computeDiscipline([buy(1000)], [], [], policy, '', [plan({ advice: [declined, declined] })])).toMatchObject({ declinedRequired: 2, score: base - 6 })
    expect(computeDiscipline([buy(1000)], [], [], policy, '', [plan({ advice: Array(9).fill(declined) })]).penalties.declined).toBe(15)
    expect(computeDiscipline([buy(1000)], [], [], policy, '', [plan({ status: 'draft', advice: [declined] })]).declinedRequired).toBe(0)
    const exception = { ...buy(1000), checklist: [{ key: 'a', label: 'a', passed: false }], exceptionReason: 'x' }
    expect(computeDiscipline([exception], [], [], policy, '', [plan({ advice: [declined] })]).declinedRequired).toBe(0)
  })
})

describe('tierOf', () => {
  it('maps scores to tiers', () => {
    expect(tierOf(95)).toContain('優秀')
    expect(tierOf(80)).toBe('良好')
    expect(tierOf(65)).toContain('需改進')
    expect(tierOf(40)).toContain('警示')
  })
})
