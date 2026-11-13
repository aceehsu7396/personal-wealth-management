import type { DipLadder } from '../storage/schema'

// The dip ladder (handbook 08 §2.4): reserve cash written down in advance
// for each TAIEX drawdown step. A step is due when the drawdown reaches it,
// it has an amount, and it has not been done since the last 52-week high.

export type DipStep = DipLadder['steps'][number]

export interface DipLadderStatus {
  // The deepest step reached that is still to do.
  due: DipStep | null
  done: (step: DipStep) => boolean
  // The living-expense buffer is below its target, so reserve cash comes first.
  bufferShort: boolean
}

export function dipLadderStatus(
  ladder: DipLadder,
  drawdown: number | null,
  lastHigh: string | null,
  buffer: { amount: number; target: number },
): DipLadderStatus {
  const done = (step: DipStep) => step.executedAt !== null && (lastHigh === null || step.executedAt >= lastHigh)
  const reached = drawdown === null ? [] : ladder.steps.filter((s) => s.amountTwd > 0 && drawdown <= s.drawdownPercent && !done(s))
  const due = reached.sort((a, b) => a.drawdownPercent - b.drawdownPercent)[0] ?? null
  return { due, done, bufferShort: buffer.target > 0 && buffer.amount < buffer.target }
}
