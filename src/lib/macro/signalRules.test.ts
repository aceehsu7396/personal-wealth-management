import { describe, expect, it } from 'vitest'
import type { MacroData, Point } from './macroData'
import { AUTO_NOTE, judgeSignals, lightOf, rulesCheckIn, shouldAutoSave } from './signalRules'
import type { MacroCheckIn } from '../storage/schema'

// Monthly points ending 2026-09-01, oldest first.
function monthly(values: number[]): Point[] {
  return values.map((value, i) => {
    const total = 2026 * 12 + 8 - (values.length - 1 - i)
    return { date: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`, value }
  })
}

const flat = (n: number, v: number) => Array.from({ length: n }, () => v)

function data(overrides: Partial<MacroData['series']> = {}, rest: Partial<MacroData> = {}): MacroData {
  return {
    generatedAt: '2026-10-15T00:00:00Z',
    errors: [],
    series: {
      IPMAN: monthly(flat(24, 100)),
      UNRATE: monthly(flat(24, 4)),
      PAYEMS: monthly(Array.from({ length: 24 }, (_, i) => 150_000 + i * 100)),
      CPIAUCSL: monthly(Array.from({ length: 24 }, (_, i) => 300 * 1.0025 ** i)),
      PCEPILFE: monthly(Array.from({ length: 24 }, (_, i) => 120 * 1.0025 ** i)),
      FEDFUNDS: monthly(flat(24, 4)),
      T10Y2Y: monthly(flat(24, 0.3)),
      BAMLH0A0HYM2: monthly(flat(24, 4)),
      WALCL: monthly(flat(24, 7_000_000)),
      DTWEXBGS: monthly(flat(24, 120)),
      VIXCLS: monthly(flat(24, 18)),
      TW_BUSINESS_SCORE: monthly(flat(24, 25)),
      TW_EXPORTS: monthly(flat(24, 2000)),
      TW_CPI: monthly(Array.from({ length: 24 }, (_, i) => 105 * 1.0015 ** i)),
      ...overrides,
    },
    margin: { now: { date: '2026-10-14', value: 100 }, before: { date: '2026-07-14', value: 100 } },
    fubon: [],
    ...rest,
  }
}

describe('judgeSignals', () => {
  it('reads a calm, steady economy as neutral everywhere', () => {
    const j = judgeSignals(data())
    const values = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v.value]))
    expect(values).toMatchObject({
      'growth.usPmi': 'flat',
      'growth.usEmployment': 'flat',
      'inflation.usCpi': 'flat',
      'inflation.twCpi': 'flat',
      'liquidity.policyRate': 0,
      'liquidity.yieldCurve': 0,
      'sentiment.vix': 0,
    })
    expect(j['sentiment.media'].manual).toBe(true)
    expect(j['sentiment.valuation'].manual).toBe(true) // no Fubon report
    expect(j['growth.usPmi'].reason).toContain('FRED IPMAN')
  })

  it('turns rate cuts, a weak dollar and a steep curve into loose liquidity', () => {
    const j = judgeSignals(
      data({
        FEDFUNDS: monthly([...flat(20, 4.5), 4.25, 4.0, 3.75, 3.75]),
        T10Y2Y: monthly([...flat(23, 0.3), 0.6]),
        DTWEXBGS: monthly([...flat(20, 120), 118, 116, 115, 114]),
        BAMLH0A0HYM2: monthly([...flat(20, 4), 3.8, 3.6, 3.4, 3.4]),
        WALCL: monthly([...flat(20, 7_000_000), 7_050_000, 7_100_000, 7_150_000, 7_200_000]),
      }),
    )
    expect(j['liquidity.policyRate'].value).toBe(1)
    expect(j['liquidity.yieldCurve'].value).toBe(1)
    expect(j['liquidity.usDollar'].value).toBe(1)
    expect(j['liquidity.creditSpread'].value).toBe(1)
    expect(j['liquidity.centralBankBalanceSheet'].value).toBe(1)
  })

  it('flags overheating and panic at the thresholds', () => {
    const hot = judgeSignals(
      data(
        { VIXCLS: monthly([...flat(23, 18), 12.9]), BAMLH0A0HYM2: monthly(flat(24, 2.9)) },
        {
          margin: { now: { date: '2026-10-14', value: 116 }, before: { date: '2026-07-14', value: 100 } },
          fubon: [{ valuation: { pe: 22, average: 19, sdLow: 17, sdHigh: 21 }, reportDate: '2026-09-02', reportTitle: '富邦總經觀點-9月市場展望', summary: '' } as never],
        },
      ),
    )
    expect(hot['sentiment.vix'].value).toBe(1)
    expect(hot['sentiment.credit'].value).toBe(1)
    expect(hot['sentiment.margin'].value).toBe(1)
    expect(hot['sentiment.valuation'].value).toBe(1)
    const panic = judgeSignals(data({ VIXCLS: monthly([...flat(23, 18), 31]) }))
    expect(panic['sentiment.vix'].value).toBe(-1)
  })

  it('reads growth and inflation turns', () => {
    const j = judgeSignals(
      data({
        IPMAN: monthly([...flat(18, 100), 100, 100, 100, 101, 101, 101]),
        UNRATE: monthly([...flat(21, 4), 4.3, 4.4, 4.5]),
        PAYEMS: monthly([...Array.from({ length: 21 }, (_, i) => 150_000 + i * 100), 152_000, 152_010, 152_020]),
        TW_BUSINESS_SCORE: monthly([...flat(21, 25), 28, 30, 32]),
        CPIAUCSL: monthly([...Array.from({ length: 21 }, (_, i) => 300 * 1.0025 ** i), 300 * 1.0025 ** 20 * 1.006, 300 * 1.0025 ** 20 * 1.012, 300 * 1.0025 ** 20 * 1.018]),
      }),
    )
    expect(j['growth.usPmi'].value).toBe('up')
    expect(j['growth.usEmployment'].value).toBe('down')
    expect(j['growth.twBusinessSignal'].value).toBe('up')
    expect(j['growth.twBusinessSignal'].reason).toContain('黃紅燈')
    expect(j['inflation.usCpi'].value).toBe('up')
  })

  it('uses the latest issue with a valuation chart when the newest has none', () => {
    const issue = (reportDate: string, valuation: unknown) =>
      ({ reportDate, reportTitle: `${reportDate} 報告`, summary: '', valuation }) as never
    const sep = issue('2026-09-02', { pe: 23, average: 19, sdLow: 17, sdHigh: 21 })
    const j = judgeSignals(data({}, { fubon: [sep, issue('2026-10-07', null)] }))
    expect(j['sentiment.valuation']).toMatchObject({ value: 1, manual: false })
    expect(j['sentiment.valuation'].reason).toContain('2026-09-02 報告')
    const stale = judgeSignals(data({}, { fubon: [issue('2026-06-03', { pe: 23, average: 19, sdLow: 17, sdHigh: 21 }), issue('2026-10-07', null)] }))
    expect(stale['sentiment.valuation'].manual).toBe(true)
  })

  it('marks missing sources as neutral and manual', () => {
    const j = judgeSignals(data({ VIXCLS: undefined, TW_CPI: undefined }, { margin: null }))
    expect(j['sentiment.vix']).toMatchObject({ value: 0, manual: true })
    expect(j['inflation.twCpi']).toMatchObject({ value: 'flat', manual: true })
    expect(j['sentiment.margin'].manual).toBe(true)
  })
})

describe('rulesCheckIn / shouldAutoSave', () => {
  const { checkIn, manual } = rulesCheckIn(data(), '2026-10-15')

  it('builds a check-in with a reason for every signal and the numbers behind them', () => {
    expect(checkIn.note).toBe(AUTO_NOTE)
    expect(Object.keys(checkIn.reasons!)).toHaveLength(17)
    expect(checkIn.metrics).toMatchObject({ 'sentiment.vix': 18, 'liquidity.yieldCurve': 0.3, 'growth.twBusinessSignal': 25 })
    expect(checkIn.metrics!['sentiment.media']).toBeUndefined()
    expect(manual).toContain('sentiment.media')
  })

  it('never overwrites a manual correction or an AI review, and skips unchanged data', () => {
    const saved = { ...checkIn, id: 'x', createdAt: '' } as MacroCheckIn
    expect(shouldAutoSave(undefined, checkIn)).toBe(true)
    expect(shouldAutoSave(saved, checkIn)).toBe(false)
    expect(shouldAutoSave({ ...saved, sentiment: { ...saved.sentiment, vix: 1 } }, checkIn)).toBe(true)
    expect(shouldAutoSave({ ...saved, note: '已手動修正' }, checkIn)).toBe(false)
  })

  it('names the business-signal light', () => {
    expect([lightOf(41), lightOf(35), lightOf(25), lightOf(20), lightOf(12)]).toEqual(['紅燈', '黃紅燈', '綠燈', '黃藍燈', '藍燈'])
  })
})
