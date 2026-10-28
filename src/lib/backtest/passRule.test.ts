import { describe, expect, it } from 'vitest'
import type { BacktestStats } from '../storage/schema'
import { outOfSampleVerdict } from './passRule'

const stats = (o: Partial<BacktestStats>): BacktestStats => ({
  totalReturn: 0.5, cagr: 0.1, maxDrawdown: -0.3, sharpe: 1, trades: 30, winRate: 0.5, profitFactor: 1.5, exposure: 0.6, ...o,
})
const bh = stats({ cagr: 0.2, maxDrawdown: -0.3, sharpe: 1 })

describe('outOfSampleVerdict', () => {
  it('passes on a higher return', () => {
    expect(outOfSampleVerdict(stats({ cagr: 0.25 }), bh)).toMatchObject({ passed: true, route: 'return' })
  })

  it('passes on a better Sharpe ratio with at most 2/3 of the drawdown', () => {
    expect(outOfSampleVerdict(stats({ cagr: 0.15, sharpe: 1.1, maxDrawdown: -0.2 }), bh)).toMatchObject({ passed: true, route: 'risk' })
  })

  it('fails when the drawdown is not clearly smaller, the Sharpe ratio is lower, or the return is negative', () => {
    expect(outOfSampleVerdict(stats({ cagr: 0.15, sharpe: 1.1, maxDrawdown: -0.21 }), bh).passed).toBe(false)
    expect(outOfSampleVerdict(stats({ cagr: 0.15, sharpe: 0.9, maxDrawdown: -0.1 }), bh).passed).toBe(false)
    expect(outOfSampleVerdict(stats({ cagr: -0.01, sharpe: 2, maxDrawdown: -0.01 }), bh).passed).toBe(false)
    expect(outOfSampleVerdict(null, bh)).toMatchObject({ passed: false, reason: '未設定樣本外，無法判定' })
  })
})
