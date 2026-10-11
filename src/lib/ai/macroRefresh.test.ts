import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FubonOutlook } from '../storage/schema'
import type { MacroDraft } from './analyses'

const digestFubonOutlook = vi.fn()
const analyzeMarket = vi.fn()
vi.mock('./fubonOutlook', () => ({ digestFubonOutlook: (...a: unknown[]) => digestFubonOutlook(...a) }))
vi.mock('./analyses', async (orig) => ({
  ...(await orig<typeof import('./analyses')>()),
  analyzeMarket: (...a: unknown[]) => analyzeMarket(...a),
}))

const { needsNewDigest, refreshMacro } = await import('./macroRefresh')

const t = { value: 'flat' as const, reason: '持平' }
const s = { value: '0' as const, reason: '中性' }
const facts: MacroDraft = {
  growth: { usPmi: t, usEmployment: t, twBusinessSignal: t, twExportOrders: t },
  inflation: { usCpi: t, twCpi: t },
  liquidity: { policyRate: { value: '1', reason: '降息' }, yieldCurve: s, creditSpread: s, centralBankBalanceSheet: s, usDollar: s },
  sentiment: { valuation: s, credit: s, ipoHype: s, media: s, margin: s, vix: s },
  policyNote: '',
}

function outlook(reportDate: string): FubonOutlook {
  return {
    id: reportDate, reportTitle: `報告 ${reportDate}`, reportDate, pdfUrl: '', createdAt: '', markdown: '', sources: [],
    estimatedCostUsd: 0.1, summary: '', sections: [], allocation: [], forecasts: [], actuals: [], coverage: [],
  }
}

beforeEach(() => {
  digestFubonOutlook.mockReset()
  analyzeMarket.mockReset()
  analyzeMarket.mockResolvedValue({ research: { markdown: '', sources: [] }, facts, estimatedCostUsd: 0.3 })
})

describe('needsNewDigest', () => {
  it('re-digests only when the stored report is from an earlier month', () => {
    expect(needsNewDigest(undefined, '2026-10-11')).toBe(true)
    expect(needsNewDigest(outlook('2026-09-02'), '2026-10-11')).toBe(true)
    expect(needsNewDigest(outlook('2026-10-02'), '2026-10-11')).toBe(false)
  })
})

describe('refreshMacro', () => {
  it('digests the new report, then analyses with it and builds the check-in', async () => {
    digestFubonOutlook.mockResolvedValue({ ...outlook('2026-10-02'), id: undefined, createdAt: undefined })
    const r = await refreshMacro('2026-10-11', [outlook('2026-09-02')])
    expect(r.newOutlook?.reportDate).toBe('2026-10-02')
    expect(analyzeMarket.mock.calls[0][2].reportDate).toBe('2026-10-02')
    expect(r.usedOutlook).toBe(true)
    expect(r.checkIn.liquidity.policyRate).toBe(1)
    expect(r.checkIn.reasons['liquidity.policyRate']).toBe('降息')
    expect(r.estimatedCostUsd).toBeCloseTo(0.4)
  })

  it('reuses this month’s digest without fetching again', async () => {
    const r = await refreshMacro('2026-10-11', [outlook('2026-10-02')])
    expect(digestFubonOutlook).not.toHaveBeenCalled()
    expect(r.newOutlook).toBeUndefined()
    expect(r.usedOutlook).toBe(true)
  })

  it('still analyses when digesting fails, using a stored report only if fresh', async () => {
    digestFubonOutlook.mockRejectedValue(new Error('這次沒有讀取到富邦報告'))
    const r = await refreshMacro('2026-12-20', [outlook('2026-09-02')])
    expect(r.digestError).toContain('沒有讀取到')
    expect(analyzeMarket.mock.calls[0][2]).toBeUndefined()
    expect(r.usedOutlook).toBe(false)
  })
})
