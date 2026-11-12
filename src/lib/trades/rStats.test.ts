import { describe, expect, it } from 'vitest'
import { adviceUptake, closedResults, groupR, regimeOfPlan } from './rStats'
import type { Trade, TradePlan } from '../storage/schema'

const plan = (id: string, over: Partial<TradePlan> = {}): TradePlan =>
  ({ id, status: 'closed', entryMethod: 'breakout', fillPrice: 100, stopLoss: 90, advice: [], ...over }) as TradePlan
const sell = (planId: string, price: number, shares = 10): Trade => ({ planId, side: 'sell', price, shares }) as Trade

describe('R statistics', () => {
  const plans = [plan('a'), plan('b', { entryMethod: 'value_batches', regimeSnapshot: '修正（2026-11-10 起）・部位倍數 0.5' }), plan('c', { status: 'open' })]
  const trades = [sell('a', 120, 5), sell('a', 110, 5), sell('b', 85)]

  it('measures R from the plan sells', () => {
    const r = closedResults(plans, trades)
    expect(r.map((x) => x.r)).toEqual([1.5, -1.5])
  })

  it('groups by method and regime and flags small samples', () => {
    const g = groupR(closedResults(plans, trades), (p) => p.entryMethod)
    expect(g).toHaveLength(2)
    expect(g.every((x) => !x.enough)).toBe(true)
    expect(regimeOfPlan(plans[1])).toBe('修正')
  })

  it('compares plans that followed required advice with those that did not', () => {
    const withAdvice = [
      plan('a', { advice: [{ level: 'required', text: 'x', basis: '', decision: 'accepted' }] }),
      plan('b', { advice: [{ level: 'required', text: 'y', basis: '', decision: 'declined', reason: 'z' }] }),
    ]
    const u = adviceUptake(withAdvice, closedResults(withAdvice, trades))
    expect(u.byLevel.required).toEqual({ decided: 2, accepted: 1 })
    expect(u.followedR).toBe(1.5)
    expect(u.declinedR).toBe(-1.5)
  })
})
