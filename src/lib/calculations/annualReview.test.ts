import { describe, expect, it } from 'vitest'
import { annualReport, suggestions, type AnnualInput } from './annualReview'

const base: AnnualInput = {
  year: '2026',
  goal: { readiness: '2/5', netWorth: 'NT$8,000,000', requiredReturn: '6.4%' },
  returns: { from: '2026-01-01', to: '2026-12-31', twr: 0.1, twrAnnual: 0.1, mwrAnnual: 0.09 },
  excessReturn: 0.01,
  execution: { planned: 3, satelliteBuys: 4, avgSlippage: 0.001, lateStops: 0 },
  uptake: { byLevel: { required: { decided: 2, accepted: 2 }, suggest: { decided: 0, accepted: 0 }, notice: { decided: 0, accepted: 0 } }, followedR: 0.8, declinedR: null, followedCount: 3, declinedCount: 0 },
  byMethod: [],
  exceptions: 1,
  pauses: 0,
  circuitBreaker: false,
  regimeHitRate: 0.6,
  regimeScored: 5,
  calibration: { resolved: 0, brier: null, baseline: null, bands: [] },
  decisions: { total: 2, reviewed: 1, avgQuality: 4 },
}

describe('annual review', () => {
  it('says so when no rule fires', () => {
    expect(suggestions(base)).toEqual(['沒有規則觸發的修訂建議；投資政策與局勢參數可以維持。'])
  })

  it('suggests revisions from fixed rules', () => {
    const s = suggestions({
      ...base,
      returns: { ...base.returns!, mwrAnnual: 0.05 },
      execution: { ...base.execution, lateStops: 2 },
      byMethod: [{ key: '突破', count: 6, winRate: 0.3, avgR: -0.2, expectancy: -0.2, enough: true }],
      calibration: { resolved: 3, brier: 0.7, baseline: 0.5, bands: [] },
      uptake: { ...base.uptake, declinedR: -0.5, declinedCount: 2 },
      pauses: 1,
    })
    expect(s).toHaveLength(6)
    expect(s[0]).toContain('觸價停損單')
  })

  it('renders the report as Markdown', () => {
    const r = annualReport(base)
    expect(r.sections).toHaveLength(5)
    expect(r.markdown).toContain('# 2026 年度檢討報告')
    expect(r.markdown).toContain('## 6 修訂建議')
  })
})
