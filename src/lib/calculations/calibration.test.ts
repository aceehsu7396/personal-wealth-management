import { describe, expect, it } from 'vitest'
import { brierScore, calibration, evenGuessScore, isBalanced } from './calibration'
import type { ScenarioSet } from '../storage/schema'

const shock = { tw: 0, us: 0, bond: 0, fx: 0 }
const set = (probs: number[], outcome?: number): ScenarioSet => ({
  id: 'x',
  date: '2026-01-01',
  question: '',
  horizon: '2026-06-30',
  premortem: '',
  scenarios: probs.map((probability, i) => ({ name: `s${i}`, probability, trigger: '', signals: '', shock, actions: '' })),
  outcome,
})

describe('calibration', () => {
  it('scores a set with the Brier rule', () => {
    expect(brierScore(set([70, 30], 0))).toBeCloseTo(0.18)
    expect(brierScore(set([70, 30], 1))).toBeCloseTo(0.98)
    expect(brierScore(set([70, 30]))).toBeNull()
    expect(evenGuessScore(2)).toBe(0.5)
    expect(isBalanced(set([60, 30]))).toBe(false)
  })

  it('compares predicted and observed by band', () => {
    const c = calibration([set([70, 30], 0), set([70, 30], 1), set([50, 50])])
    expect(c.resolved).toBe(2)
    expect(c.brier).toBeCloseTo(0.58)
    expect(c.baseline).toBeCloseTo(0.5)
    const sixty = c.bands.find((b) => b.label === '60–80%')!
    expect(sixty.count).toBe(2)
    expect(sixty.observed).toBeCloseTo(0.5)
  })
})
