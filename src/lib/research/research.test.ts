import { beforeEach, describe, expect, it, vi } from 'vitest'
import sample from './__fixtures__/finmind-sample.json'
import {
  analyzeStatements,
  byQuarter,
  decumulate,
  fairValues,
  suggestLynch,
  summarizeDividends,
  valuationStats,
  type DividendRow,
  type FinRow,
  type PerRow,
} from './fundamentals'
import { analyzeEtf, type PriceRow } from './etfProfile'
import { buildAutoResearch, derivedFields, isStale, NotFoundError } from './autoResearch'

// Real FinMind responses (2026/10), trimmed to the fields the code reads.
type Raw = Record<string, Record<string, unknown[][]>>
const raw = sample as unknown as Raw
const fin = (rows: unknown[][]): FinRow[] => rows.map(([date, type, value]) => ({ date, type, value }) as FinRow)
const div = (rows: unknown[][]): DividendRow[] =>
  rows.map(([d, a, b]) => ({ CashExDividendTradingDate: d, CashEarningsDistribution: a, CashStatutorySurplus: b }) as DividendRow)
const per = (rows: unknown[][]): PerRow[] => rows.map(([date, PER, PBR, y]) => ({ date, PER, PBR, dividend_yield: y }) as PerRow)
const prices = (rows: unknown[][]): PriceRow[] =>
  rows.map(([date, open, max, min, close, money]) => ({ date, open, max, min, close, Trading_money: money }) as PriceRow)

const TODAY = '2026-10-23'

function health(id: '2330' | '2881', industry: string) {
  const r = raw[id]
  return analyzeStatements({
    income: fin(r.income),
    balance: fin(r.balance),
    cashflow: fin(r.cashflow),
    dividends: div(r.dividends),
    industry,
    today: TODAY,
  })!
}

describe('statements', () => {
  it('splits year-to-date cash flows into quarters', () => {
    const q = decumulate(
      byQuarter([
        { date: '2025-03-31', type: 'CFO', value: 100 },
        { date: '2025-06-30', type: 'CFO', value: 250 },
        { date: '2025-09-30', type: 'CFO', value: 330 },
        { date: '2026-03-31', type: 'CFO', value: 90 },
      ]),
    )
    expect(q.map((x) => x.v.CFO)).toEqual([100, 150, 80, 90])
  })

  it('checks 台積電: F-score, ROE, growth, red flags and free cash flow', () => {
    const h = health('2330', '半導體業')
    expect(h.asOf).toBe('2026-06-30')
    expect(h.isFinancial).toBe(false)
    expect(h.fScore!.score).toBe(8)
    expect(h.fScore!.items.find((i) => !i.passed)!.key).toBe('turnover')
    expect(h.roe!).toBeCloseTo(40.6, 0)
    expect(h.epsTtm!).toBeCloseTo(86.28, 1)
    expect(h.epsCagr3y!).toBeCloseTo(32.3, 0)
    expect(h.redFlags.map((f) => f.key)).toEqual(['receivables'])
    expect(h.freeCashFlow.map((f) => f.year)).toEqual(['2023', '2024', '2025'])
    expect(suggestLynch(h, '半導體業', 9.6)).toBe('fast_grower')
  })

  it('treats a financial holding as financial: no F-score, no accrual flags', () => {
    const h = health('2881', '金融保險')
    expect(h.isFinancial).toBe(true)
    expect(h.fScore).toBeNull()
    expect(h.redFlags).toEqual([])
    expect(h.roe!).toBeGreaterThan(10)
    expect(suggestLynch(h, '金融保險', 1.2)).toBe('stalwart')
  })

  it('counts consecutive dividend years and the payout ratio', () => {
    const rows = ['2022-07-01', '2023-07-01', '2024-07-01', '2025-07-01', '2026-01-10'].map((d) => ({
      CashExDividendTradingDate: d,
      CashEarningsDistribution: 2,
      CashStatutorySurplus: 0,
    }))
    expect(summarizeDividends(rows, 10, TODAY)).toEqual({ consecutiveYears: 5, lastYearCash: 2, payoutRatio: 20 })
  })
})

describe('valuation', () => {
  const v = valuationStats(per(raw['2330'].per))

  it('places today’s P/E in its five-year range', () => {
    expect(v.years).toBeGreaterThan(4.9)
    expect(v.pe!.p20).toBeLessThan(v.pe!.p50)
    expect(v.pe!.p50).toBeLessThan(v.pe!.p80)
    expect(v.pe!.percentile).toBeGreaterThan(50)
  })

  it('builds three scenarios from EPS, capped growth and the P/E percentiles', () => {
    const f = fairValues({ epsTtm: 86.28, epsCagr3y: 32.3, isFinancial: false, price: 2400, valuation: v })!
    expect(f.method).toBe('pe')
    expect(f.growthPercent).toBe(20)
    expect(f.bear).toBeCloseTo(86.28 * v.pe!.p20, 1)
    expect(f.base).toBeCloseTo(86.28 * 1.2 * v.pe!.p50, 1)
    expect(f.bull).toBeCloseTo(86.28 * 1.2 * v.pe!.p80, 1)
    const adjusted = fairValues({ epsTtm: 86.28, epsCagr3y: 32.3, isFinancial: false, price: 2400, valuation: v }, { growthPercent: 10, multiples: [15, 20, 25] })!
    expect(adjusted.base).toBeCloseTo(86.28 * 1.1 * 20, 1)
  })

  it('uses book value for losses and financials', () => {
    const loss = fairValues({ epsTtm: -1, epsCagr3y: null, isFinancial: false, price: 100, valuation: v })!
    expect(loss.method).toBe('pb')
    expect(loss.base).toBeCloseTo((100 / v.pb!.current!) * v.pb!.p50, 1)
    expect(fairValues({ epsTtm: 5, epsCagr3y: 5, isFinancial: true, price: 100, valuation: v })!.method).toBe('pb')
  })
})

describe('ETF profile', () => {
  const bench = { prices: prices(raw['0050'].prices), dividends: div(raw['0050'].dividends) }

  it('reads through the 2025 split and reinvests distributions', () => {
    const p = analyzeEtf({ ...bench, today: TODAY })!
    expect(p.returns.y1!).toBeGreaterThan(0)
    expect(p.maxDrawdown!).toBeGreaterThan(-50)
    expect(p.yieldTtm!).toBeCloseTo(1.5, 1)
    expect(p.vs0050).toBeNull()
  })

  it('compares a high-dividend ETF with 0050', () => {
    const p = analyzeEtf({ prices: prices(raw['00878'].prices), dividends: div(raw['00878'].dividends), benchmark: bench, today: TODAY })!
    expect(p.distributions12m).toBe(4)
    expect(p.yieldTtm!).toBeGreaterThan(5)
    expect(p.vs0050!.beta!).toBeLessThan(1)
    expect(p.vs0050!.correlation!).toBeGreaterThan(0.5)
    expect(p.avgTradeValue!).toBeGreaterThan(1)
  })
})

describe('buildAutoResearch', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  // A fake FinMind serving the fixtures in its response format.
  function fetcher(info: Record<string, { industry_category: string; stock_name: string }>) {
    return vi.fn(async (url: string) => {
      const q = new URL(url).searchParams
      const id = q.get('data_id')!
      const r = raw[id] ?? {}
      const data = {
        TaiwanStockInfo: info[id] ? [info[id]] : [],
        TaiwanStockFinancialStatements: fin(r.income ?? []).map(({ date, type, value }) => ({ date, type, value })),
        TaiwanStockBalanceSheet: fin(r.balance ?? []),
        TaiwanStockCashFlowsStatement: fin(r.cashflow ?? []),
        TaiwanStockDividend: div(r.dividends ?? []),
        TaiwanStockPER: per(r.per ?? []),
        TaiwanStockPrice: r.prices ? prices(r.prices) : [{ date: '2026-10-22', open: 2400, max: 2410, min: 2390, close: 2400, Trading_money: 1 }],
      }[q.get('dataset')!]
      return { ok: true, status: 200, json: async () => ({ status: 200, msg: 'success', data }) }
    })
  }

  it('builds a stock snapshot and the fields the card scores', async () => {
    const f = fetcher({ '2330': { industry_category: '半導體業', stock_name: '台積電' } })
    const auto = await buildAutoResearch('2330', TODAY, f)
    expect(auto).toMatchObject({ kind: 'stock', name: '台積電', industry: '半導體業', price: 2400 })
    expect(auto.stock!.lynch).toBe('fast_grower')
    const d = derivedFields(auto, undefined, {})
    expect(d.fScore).toBe(8)
    expect(d.hasUnexplainedRedFlags).toBe(true)
    expect(derivedFields(auto, undefined, { receivables: '擴產備料、客戶延長付款' }).hasUnexplainedRedFlags).toBe(false)
    expect(d.fairValueBase).toBeGreaterThan(d.fairValueBear)
    // Cached: a second build makes no new requests.
    const calls = f.mock.calls.length
    await buildAutoResearch('2330', TODAY, f)
    expect(f.mock.calls.length).toBe(calls)
  })

  it('builds an ETF snapshot against 0050', async () => {
    const auto = await buildAutoResearch('00878', TODAY, fetcher({ '00878': { industry_category: 'ETF', stock_name: '國泰永續高股息' } }))
    expect(auto.kind).toBe('etf')
    expect(auto.etf!.vs0050).not.toBeNull()
  })

  it('reports unknown codes', async () => {
    await expect(buildAutoResearch('9999', TODAY, fetcher({}))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('treats a week-old check as stale', () => {
    expect(isStale(undefined, TODAY)).toBe(true)
    expect(isStale({ fetchedAt: '2026-10-20T00:00:00Z' } as never, TODAY)).toBe(false)
    expect(isStale({ fetchedAt: '2026-10-10T00:00:00Z' } as never, TODAY)).toBe(true)
  })
})
