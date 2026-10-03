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
})

describe('tierOf', () => {
  it('maps scores to tiers', () => {
    expect(tierOf(95)).toContain('優秀')
    expect(tierOf(80)).toBe('良好')
    expect(tierOf(65)).toContain('需改進')
    expect(tierOf(40)).toContain('警示')
  })
})
