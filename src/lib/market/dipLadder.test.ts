import { describe, expect, it } from 'vitest'
import { dipLadderStatus } from './dipLadder'
import { createDefaultDipLadder, type DipLadder } from '../storage/schema'

const ladder = (over: Partial<Record<number, { amountTwd?: number; executedAt?: string | null }>> = {}): DipLadder => {
  const base = createDefaultDipLadder()
  return { ...base, steps: base.steps.map((s) => ({ ...s, amountTwd: 100_000, ...over[s.drawdownPercent] })) }
}
const buffer = { amount: 2_000_000, target: 1_440_000 }

describe('dipLadderStatus', () => {
  it('finds the deepest step reached that is still to do', () => {
    expect(dipLadderStatus(ladder(), -8, '2026-01-05', buffer).due).toBeNull()
    expect(dipLadderStatus(ladder(), -12, '2026-01-05', buffer).due?.drawdownPercent).toBe(-10)
    expect(dipLadderStatus(ladder(), -23, '2026-01-05', buffer).due?.drawdownPercent).toBe(-20)
  })

  it('skips steps done since the last high and resets after a new high', () => {
    const doneTen = ladder({ [-10]: { executedAt: '2026-03-01' } })
    expect(dipLadderStatus(doneTen, -12, '2026-01-05', buffer).due).toBeNull()
    expect(dipLadderStatus(doneTen, -12, '2026-06-01', buffer).due?.drawdownPercent).toBe(-10)
  })

  it('ignores steps without an amount and flags a short buffer', () => {
    expect(dipLadderStatus(ladder({ [-10]: { amountTwd: 0 } }), -12, null, buffer).due).toBeNull()
    expect(dipLadderStatus(ladder(), -12, null, { amount: 100, target: 1000 }).bufferShort).toBe(true)
  })
})
