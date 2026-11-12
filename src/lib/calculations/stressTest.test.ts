import { describe, expect, it } from 'vitest'
import { applyShock, exposureKind, marketFallTo, type Exposure } from './stressTest'
import type { Holding } from '../storage/schema'

const e = (over: Partial<Exposure>): Exposure => ({ id: 'x', label: 'x', valueTwd: 100, kind: 'tw_equity', usd: false, beta: 1, semis: false, ...over })

describe('applyShock', () => {
  it('scales stock moves by beta, applies currency to USD assets and leaves cash', () => {
    const r = applyShock(
      [e({ id: 'a', label: 'A', beta: 1.5 }), e({ id: 'b', label: 'B', kind: 'us_equity', usd: true }), e({ id: 'c', label: 'C', kind: 'cash' })],
      { tw: -20, us: -10, bond: 0, fx: -10 },
    )
    // A −30; B 100 × 0.9 × 0.9 − 100 = −19; C 0.
    expect(r.lossTwd).toBeCloseTo(-49)
    expect(r.lossPercent).toBeCloseTo(-49 / 3)
    expect(r.worst.map((w) => w.label)).toEqual(['A', 'B'])
  })

  it('uses the semiconductor move for semiconductor holdings', () => {
    const r = applyShock([e({ semis: true }), e({ id: 'y' })], { tw: 0, us: 0, bond: 0, fx: 0, semis: -40 })
    expect(r.lossTwd).toBeCloseTo(-40)
  })
})

describe('marketFallTo', () => {
  it('finds the fall that reaches the threshold from the current drawdown', () => {
    const half = [e({ valueTwd: 50 }), e({ id: 'c', kind: 'cash', valueTwd: 50 })]
    // From −5%, a −20% breaker needs a further 1 − 0.8/0.95 ≈ 15.8% loss;
    // half the portfolio moves with the market, so the market falls ≈ 31.6%.
    const fall = marketFallTo(half, -5, 20)!
    expect(fall).toBeCloseTo(31.58, 1)
    expect(marketFallTo(half, -25, 20)).toBe(0)
    expect(marketFallTo([e({ kind: 'cash' })], 0, 20)).toBeNull()
  })
})

describe('exposureKind', () => {
  it('reads the asset class from sleeve and fund type', () => {
    const h = (over: Partial<Holding>) => ({ sleeve: 'core_tw', currency: 'TWD', ...over }) as Holding
    expect(exposureKind(h({}))).toBe('tw_equity')
    expect(exposureKind(h({ sleeve: 'core_global' }))).toBe('us_equity')
    expect(exposureKind(h({ sleeve: 'core_bond_cash' }))).toBe('bond')
    expect(exposureKind(h({ sleeve: 'satellite_fund', fundType: 'money_market' }))).toBe('cash')
  })
})
