import { describe, expect, it } from 'vitest'
import { applyFill, batchChecks, draftBatches, filledPosition, nextBatch, type Batch } from './batches'

const at = '2026-11-01T00:00:00Z'
const b = (price: number, shares: number, over: Partial<Batch> = {}): Batch => ({ kind: 'batch', price, shares, addedAt: at, ...over })

describe('batches', () => {
  it('drafts the research card batches at the per-batch size', () => {
    const levels = [
      { key: 'batch1', price: 960 },
      { key: 'batch2', price: 864 },
      { key: 'batch3', price: 700 },
      { key: 'stop', price: 885 },
    ]
    expect(draftBatches(levels, 86, at).map((x) => [x.price, x.shares])).toEqual([
      [960, 86],
      [864, 86],
      [700, 86],
    ])
    expect(draftBatches(levels, 0, at)).toEqual([])
  })

  it('fills batches in turn and keeps the average cost', () => {
    const plan = { batches: [b(960, 100), b(864, 100)], shares: 100, fillPrice: undefined }
    const one = applyFill(plan, 955, 100, '2026-11-02')
    expect(one).toMatchObject({ shares: 100, fillPrice: 955 })
    const two = applyFill({ ...plan, ...one }, 865, 100, '2026-11-10')
    expect(two).toMatchObject({ shares: 200, fillPrice: 910 })
    expect(nextBatch(two.batches)).toBe(-1)
    expect(filledPosition(two.batches)).toEqual({ shares: 200, avg: 910 })
    // An unplanned add beyond the batches still updates the totals.
    expect(applyFill({ ...plan, ...two }, 1000, 100, '2026-11-20')).toMatchObject({ shares: 300, fillPrice: 940 })
  })
})

describe('batchChecks', () => {
  const base = { riskBudgetTwd: 30_000, positionCapTwd: 1_000_000, addOn: 'allowed' as const, fxUsdTwd: 30 }
  const plan = (batches: Batch[], stop = 885) => ({ batches, stopLoss: stop, currentStop: stop, createdAt: at, market: 'TW' as const })

  it('caps the total stop risk across all batches and says how many shares fit', () => {
    const p = plan([b(960, 200, { filledAt: '2026-11-02', fillPrice: 960, fillShares: 200 }), b(940, 300)])
    const a = batchChecks({ ...base, plan: p })
    // (960 − 885) × 200 + (940 − 885) × 300 = 31,500 > 30,000; room 15,000 ÷ 55 = 272.
    expect(a[0].level).toBe('required')
    expect(a[0].text).toContain('下一批最多 272 股')
  })

  it('applies the regime add-on rule and the position cap', () => {
    const filledFirst = [b(960, 50, { filledAt: '2026-11-02' }), b(900, 50)]
    expect(batchChecks({ ...base, addOn: 'none', regimeLabel: '空頭', plan: plan(filledFirst) }).map((a) => a.text)).toContain('空頭不加碼：第 2 批先不要買')
    const lateAdd = [b(960, 50, { filledAt: '2026-11-02' }), b(1000, 20, { kind: 'add', addedAt: '2026-11-05T00:00:00Z' })]
    expect(batchChecks({ ...base, addOn: 'scheduled', plan: plan(lateAdd, 990) }).some((a) => a.text.includes('事先寫好'))).toBe(true)
    expect(batchChecks({ ...base, positionCapTwd: 50_000, plan: plan(filledFirst) }).some((a) => a.text.includes('單一部位上限'))).toBe(true)
  })

  it('suggests adding only once the trade is in profit and the stop is at cost', () => {
    const p = plan([b(960, 50, { filledAt: '2026-11-02' }), b(1000, 20, { kind: 'add' })], 900)
    expect(batchChecks({ ...base, plan: p, close: 1010 }).some((a) => a.level === 'suggest')).toBe(true)
    expect(batchChecks({ ...base, plan: plan(p.batches, 965), close: 1010 }).some((a) => a.level === 'suggest')).toBe(false)
    expect(batchChecks({ ...base, plan: plan([b(960, 50)]) })).toEqual([])
  })
})
