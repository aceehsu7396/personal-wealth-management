import { describe, expect, it } from 'vitest'
import { expenseLimitFor, isFund, isNavStale, suggestSleeve } from './fundRules'

describe('suggestSleeve', () => {
  it('maps fund types to allocation sleeves', () => {
    expect(suggestSleeve('index_equity', 'TWD')).toBe('core_tw')
    expect(suggestSleeve('index_equity', 'USD')).toBe('core_global')
    expect(suggestSleeve('bond', 'USD')).toBe('core_bond_cash')
    expect(suggestSleeve('money_market', 'TWD')).toBe('core_bond_cash')
    expect(suggestSleeve('active_equity', 'USD')).toBe('satellite_fund')
    expect(suggestSleeve('balanced', 'TWD')).toBe('satellite_fund')
  })
})

describe('fund helpers', () => {
  it('treats a missing kind as a stock/ETF', () => {
    expect(isFund({ kind: undefined })).toBe(false)
    expect(isFund({ kind: 'fund' })).toBe(true)
  })

  it('uses a higher fee limit for active funds', () => {
    expect(expenseLimitFor('core_global')).toBe(1)
    expect(expenseLimitFor('satellite_fund')).toBe(2)
  })

  it('flags NAVs older than a week', () => {
    expect(isNavStale('2026-10-01', '2026-10-09')).toBe(true)
    expect(isNavStale('2026-10-05', '2026-10-09')).toBe(false)
    expect(isNavStale(undefined, '2026-10-09')).toBe(true)
  })
})
