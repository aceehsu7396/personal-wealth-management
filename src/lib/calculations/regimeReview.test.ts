import { describe, expect, it } from 'vitest'
import { reviewHistory, reviewSegment } from './regimeReview'
import type { RegimeSegment } from '../market/regime'

const seg = (regime: RegimeSegment['regime'], m3: number | null, start = '2026-01-01'): RegimeSegment => ({
  regime,
  start,
  confirmedOn: start,
  end: start,
  startClose: 100,
  after: { m1: null, m3, m6: null },
})

describe('regime review', () => {
  it('scores defensive and offensive regimes by the next three months', () => {
    expect(reviewSegment(seg('correction', -4), 30, -11).verdict).toBe('right')
    expect(reviewSegment(seg('correction', 8), 30, -11).verdict).toBe('wrong')
    expect(reviewSegment(seg('bull', 3), 30, 0).verdict).toBe('right')
    expect(reviewSegment(seg('bull', -2), 30, 0).verdict).toBe('unclear')
    expect(reviewSegment(seg('range', -20), 30, 0).verdict).toBe('unscored')
    expect(reviewSegment(seg('bear', null), 30, 0).verdict).toBe('pending')
  })

  it('flags late defence and whipsaws', () => {
    expect(reviewSegment(seg('bear', -5), 30, -18).late).toBe(true)
    expect(reviewSegment(seg('bull', 5), 4, 0).whipsaw).toBe(true)
    const r = reviewHistory([seg('bull', 5, 'a'), seg('correction', 9, 'c')], ['a', 'b', 'c', 'd'], () => 0)
    expect(r.rows.map((x) => x.verdict)).toEqual(['right', 'wrong'])
    expect(r.hitRate).toBe(0.5)
  })
})
