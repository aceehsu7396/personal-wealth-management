import type { LynchCategory } from '../storage/schema'

// A stock's health check from FinMind's quarterly statements (handbook
// chapter 07): quality, growth, safety, red flags, dividends and a
// valuation range from its own five-year multiples. Pure functions.

export interface FinRow {
  date: string
  type: string
  value: number
}

export interface DividendRow {
  CashEarningsDistribution: number
  CashStatutorySurplus: number
  CashExDividendTradingDate: string
}

export interface PerRow {
  date: string
  PER: number
  PBR: number
  dividend_yield: number
}

type Values = Record<string, number>

// Statement rows → quarter-end date → item values, oldest first.
export function byQuarter(rows: FinRow[]): { date: string; v: Values }[] {
  const map = new Map<string, Values>()
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue
    const v = map.get(r.date) ?? {}
    v[r.type] = r.value
    map.set(r.date, v)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, v }))
}

// Cash-flow statements are cumulative within each fiscal year: subtract
// the previous quarter of the same year. Quarters whose predecessor is
// missing (other than Q1) are dropped.
export function decumulate(quarters: { date: string; v: Values }[]): { date: string; v: Values }[] {
  const out: { date: string; v: Values }[] = []
  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i]
    if (q.date.slice(5, 7) === '03') {
      out.push(q)
      continue
    }
    const prev = quarters[i - 1]
    if (!prev || prev.date.slice(0, 4) !== q.date.slice(0, 4) || monthsApart(prev.date, q.date) !== 3) continue
    const v: Values = {}
    for (const [k, value] of Object.entries(q.v)) if (prev.v[k] !== undefined) v[k] = value - prev.v[k]
    out.push({ date: q.date, v })
  }
  return out
}

function monthsApart(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

function quarterBefore(date: string, quarters: number): string {
  const [y, m] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) - quarters * 3
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const day = [3, 12].includes(month) ? 31 : 30
  return `${year}-${String(month).padStart(2, '0')}-${day}`
}

class Ledger {
  private readonly map: Map<string, Values>
  constructor(quarters: { date: string; v: Values }[]) {
    this.map = new Map(quarters.map((q) => [q.date, q.v]))
  }
  at(date: string, ...keys: string[]): number | null {
    const v = this.map.get(date)
    if (!v) return null
    for (const k of keys) if (v[k] !== undefined) return v[k]
    return null
  }
  // Sum of the four quarters ending at `date`.
  ttm(date: string, ...keys: string[]): number | null {
    let total = 0
    for (let i = 0; i < 4; i++) {
      const value = this.at(quarterBefore(date, i), ...keys)
      if (value === null) return null
      total += value
    }
    return total
  }
}

const NET_INCOME = ['EquityAttributableToOwnersOfParent', 'IncomeAfterTaxes', 'IncomeAfterTax']
const CFO = ['CashFlowsFromOperatingActivities', 'NetCashInflowFromOperatingActivities']
const CAPEX = ['PropertyAndPlantAndEquipment']
const EQUITY = ['EquityAttributableToOwnersOfParent', 'Equity']
const SHARES = ['OrdinaryShare', 'CapitalStock']

export interface FScoreItem {
  key: string
  label: string
  passed: boolean
  detail: string
}

export interface RedFlag {
  key: string
  label: string
  detail: string
}

export interface StockHealth {
  // Latest quarter covered by the statements.
  asOf: string
  isFinancial: boolean
  epsTtm: number | null
  epsTtmPrev: number | null
  roe: number | null
  grossMargin: number | null
  grossMarginPrev: number | null
  operatingMargin: number | null
  revenueCagr3y: number | null
  epsCagr3y: number | null
  revenueYoyTtm: number | null
  debtRatio: number | null
  currentRatio: number | null
  freeCashFlow: { year: string; value: number }[]
  fScore: { score: number; items: FScoreItem[] } | null
  redFlags: RedFlag[]
  dividends: { consecutiveYears: number; lastYearCash: number; payoutRatio: number | null }
}

const pct = (v: number | null, d = 1) => (v === null ? '—' : `${v.toFixed(d)}%`)
const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b)
const growth = (now: number | null, before: number | null) =>
  now === null || before === null || before <= 0 ? null : (now / before - 1) * 100
const cagr = (now: number | null, before: number | null, years: number) =>
  now === null || before === null || now <= 0 || before <= 0 ? null : ((now / before) ** (1 / years) - 1) * 100

export function analyzeStatements(input: {
  income: FinRow[]
  balance: FinRow[]
  cashflow: FinRow[]
  dividends: DividendRow[]
  industry: string
  today: string
}): StockHealth | null {
  const income = new Ledger(byQuarter(input.income))
  const incomeDates = byQuarter(input.income).map((q) => q.date)
  const balance = new Ledger(byQuarter(input.balance))
  const cashQuarters = byQuarter(input.cashflow)
  const cash = new Ledger(decumulate(cashQuarters))
  const cumulativeCash = new Ledger(cashQuarters)
  // The latest quarter with a full four-quarter income history.
  const asOf = [...incomeDates].reverse().find((d) => income.ttm(d, ...NET_INCOME) !== null)
  if (!asOf) return null
  const prev = quarterBefore(asOf, 4)
  const isFinancial = input.industry.includes('金融') || income.at(asOf, 'GrossProfit') === null

  const ni = income.ttm(asOf, ...NET_INCOME)
  const niPrev = income.ttm(prev, ...NET_INCOME)
  const revenue = income.ttm(asOf, 'Revenue')
  const revenuePrev = income.ttm(prev, 'Revenue')
  const gp = income.ttm(asOf, 'GrossProfit')
  const gpPrev = income.ttm(prev, 'GrossProfit')
  const op = income.ttm(asOf, 'OperatingIncome')
  const epsTtm = income.ttm(asOf, 'EPS')
  const epsTtmPrev = income.ttm(prev, 'EPS')
  const cfo = cash.ttm(asOf, ...CFO)
  const cfoPrev = cash.ttm(prev, ...CFO)
  const assets = balance.at(asOf, 'TotalAssets')
  const assetsPrev = balance.at(prev, 'TotalAssets')
  const equity = balance.at(asOf, ...EQUITY)
  const equityPrev = balance.at(prev, ...EQUITY)
  const liabilities = balance.at(asOf, 'Liabilities')
  const longDebt = (d: string) =>
    (balance.at(d, 'LongtermBorrowings') ?? 0) + (balance.at(d, 'BondsPayable') ?? 0)
  const currentRatio = ratio(balance.at(asOf, 'CurrentAssets'), balance.at(asOf, 'CurrentLiabilities'))
  const currentRatioPrev = ratio(balance.at(prev, 'CurrentAssets'), balance.at(prev, 'CurrentLiabilities'))
  const shares = balance.at(asOf, ...SHARES)
  const sharesPrev = balance.at(prev, ...SHARES)

  const roe = ni !== null && equity !== null ? (ni / ((equity + (equityPrev ?? equity)) / 2)) * 100 : null
  const grossMargin = ratio(gp, revenue)
  const grossMarginPrev = ratio(gpPrev, revenuePrev)
  const roa = ratio(ni, assets)
  const roaPrev = ratio(niPrev, assetsPrev)
  const turnover = ratio(revenue, assets)
  const turnoverPrev = ratio(revenuePrev, assetsPrev)
  const leverage = assets ? longDebt(asOf) / assets : null
  const leveragePrev = assetsPrev ? longDebt(prev) / assetsPrev : null

  let fScore: StockHealth['fScore'] = null
  if (!isFinancial && roa !== null && cfo !== null) {
    const items: FScoreItem[] = [
      { key: 'roa', label: '資產報酬率為正', passed: roa > 0, detail: pct(roa * 100) },
      { key: 'cfo', label: '營業現金流為正', passed: cfo > 0, detail: cfo > 0 ? '正' : '負' },
      { key: 'roaUp', label: '資產報酬率較去年改善', passed: roaPrev !== null && roa > roaPrev, detail: `${pct(roaPrev === null ? null : roaPrev * 100)} → ${pct(roa * 100)}` },
      { key: 'accruals', label: '營業現金流大於淨利（獲利品質）', passed: ni !== null && cfo > ni, detail: ni !== null ? `現金流 ÷ 淨利 ${(cfo / ni).toFixed(2)}` : '—' },
      { key: 'leverage', label: '長期負債比下降', passed: leverage !== null && leveragePrev !== null && leverage <= leveragePrev, detail: `${pct(leveragePrev === null ? null : leveragePrev * 100)} → ${pct(leverage === null ? null : leverage * 100)}` },
      { key: 'liquidity', label: '流動比率上升', passed: currentRatio !== null && currentRatioPrev !== null && currentRatio > currentRatioPrev, detail: `${currentRatioPrev?.toFixed(2) ?? '—'} → ${currentRatio?.toFixed(2) ?? '—'}` },
      { key: 'dilution', label: '沒有明顯增資稀釋（股本增加 ≤ 2%）', passed: shares !== null && sharesPrev !== null && shares <= sharesPrev * 1.02, detail: shares !== null && sharesPrev !== null ? `股本 ${growth(shares, sharesPrev)?.toFixed(1) ?? '0'}%` : '—' },
      { key: 'margin', label: '毛利率上升', passed: grossMargin !== null && grossMarginPrev !== null && grossMargin > grossMarginPrev, detail: `${pct(grossMarginPrev === null ? null : grossMarginPrev * 100)} → ${pct(grossMargin === null ? null : grossMargin * 100)}` },
      { key: 'turnover', label: '資產週轉率上升', passed: turnover !== null && turnoverPrev !== null && turnover > turnoverPrev, detail: `${turnoverPrev?.toFixed(2) ?? '—'} → ${turnover?.toFixed(2) ?? '—'}` },
    ]
    fScore = { score: items.filter((i) => i.passed).length, items }
  }

  // Red flags (Beneish-style warning signs, kept simple).
  const redFlags: RedFlag[] = []
  if (ni !== null && ni < 0) redFlags.push({ key: 'loss', label: '近四季虧損', detail: `近四季歸屬母公司淨利為負` })
  if (!isFinancial && ni !== null && cfo !== null && niPrev !== null && cfoPrev !== null && ni > cfo && niPrev > cfoPrev && ni > 0) {
    redFlags.push({ key: 'accruals', label: '淨利連兩期高於營業現金流', detail: '帳上獲利沒有變成現金，留意應收、存貨或一次性收益' })
  }
  const revenueGrowth = growth(revenue, revenuePrev)
  const ar = balance.at(asOf, 'AccountsReceivableNet')
  const arGrowth = growth(ar, balance.at(prev, 'AccountsReceivableNet'))
  if (!isFinancial && arGrowth !== null && revenueGrowth !== null && assets && ar && ar / assets > 0.03 && arGrowth - revenueGrowth > 20) {
    redFlags.push({ key: 'receivables', label: '應收帳款成長遠快於營收', detail: `應收 ${arGrowth.toFixed(0)}% vs 營收 ${revenueGrowth.toFixed(0)}%` })
  }
  const inv = balance.at(asOf, 'Inventories')
  const invGrowth = growth(inv, balance.at(prev, 'Inventories'))
  if (!isFinancial && invGrowth !== null && revenueGrowth !== null && assets && inv && inv / assets > 0.03 && invGrowth - revenueGrowth > 20) {
    redFlags.push({ key: 'inventory', label: '存貨成長遠快於營收', detail: `存貨 ${invGrowth.toFixed(0)}% vs 營收 ${revenueGrowth.toFixed(0)}%` })
  }
  const shareGrowth = growth(shares, sharesPrev)
  if (shareGrowth !== null && shareGrowth > 10) {
    redFlags.push({ key: 'dilution', label: '股本增加超過 10%', detail: `一年內股本 +${shareGrowth.toFixed(0)}%，留意增資稀釋` })
  }

  // Free cash flow per fiscal year (full-year cumulative CFO + capex).
  const freeCashFlow = cashQuarters
    .filter((q) => q.date.endsWith('-12-31'))
    .map((q) => {
      const c = cumulativeCash.at(q.date, ...CFO)
      const capex = cumulativeCash.at(q.date, ...CAPEX) ?? 0
      return c === null ? null : { year: q.date.slice(0, 4), value: c + capex }
    })
    .filter((x): x is { year: string; value: number } => x !== null)
    .slice(-3)

  return {
    asOf,
    isFinancial,
    epsTtm,
    epsTtmPrev,
    roe,
    grossMargin: grossMargin === null ? null : grossMargin * 100,
    grossMarginPrev: grossMarginPrev === null ? null : grossMarginPrev * 100,
    operatingMargin: op !== null && revenue ? (op / revenue) * 100 : null,
    revenueCagr3y: cagr(revenue, income.ttm(quarterBefore(asOf, 12), 'Revenue'), 3),
    epsCagr3y: cagr(epsTtm, income.ttm(quarterBefore(asOf, 12), 'EPS'), 3),
    revenueYoyTtm: revenueGrowth,
    debtRatio: liabilities !== null && assets ? (liabilities / assets) * 100 : null,
    currentRatio,
    freeCashFlow,
    fScore,
    redFlags,
    dividends: summarizeDividends(input.dividends, epsTtm, input.today),
  }
}

export function summarizeDividends(rows: DividendRow[], epsTtm: number | null, today: string) {
  const byYear = new Map<string, number>()
  let lastYearCash = 0
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`
  for (const r of rows) {
    const cash = (r.CashEarningsDistribution ?? 0) + (r.CashStatutorySurplus ?? 0)
    const date = r.CashExDividendTradingDate
    if (!cash || !date) continue
    byYear.set(date.slice(0, 4), (byYear.get(date.slice(0, 4)) ?? 0) + cash)
    if (date > yearAgo && date <= today) lastYearCash += cash
  }
  let consecutiveYears = 0
  const thisYear = Number(today.slice(0, 4))
  // This year may not have paid yet; count back from last year if so.
  let y = byYear.has(String(thisYear)) ? thisYear : thisYear - 1
  while (byYear.get(String(y))) {
    consecutiveYears++
    y--
  }
  return {
    consecutiveYears,
    lastYearCash: Math.round(lastYearCash * 100) / 100,
    payoutRatio: epsTtm && epsTtm > 0 && lastYearCash > 0 ? (lastYearCash / epsTtm) * 100 : null,
  }
}

// ---------------------------------------------------------------------------
// Valuation from the stock's own history of multiples
// ---------------------------------------------------------------------------

export interface MultipleStats {
  current: number | null
  p20: number
  p50: number
  p80: number
  // Where today's multiple sits in its five-year history (0–100).
  percentile: number | null
}

export interface ValuationStats {
  pe: MultipleStats | null
  pb: MultipleStats | null
  dividendYield: number | null
  years: number
}

function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

function stats(values: number[], current: number | null): MultipleStats | null {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (sorted.length < 60) return null
  const round = (v: number) => Math.round(v * 100) / 100
  return {
    current,
    p20: round(percentile(sorted, 0.2)),
    p50: round(percentile(sorted, 0.5)),
    p80: round(percentile(sorted, 0.8)),
    percentile: current && current > 0 ? Math.round((sorted.filter((v) => v <= current).length / sorted.length) * 100) : null,
  }
}

export function valuationStats(rows: PerRow[]): ValuationStats {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const last = sorted[sorted.length - 1]
  const years = sorted.length > 1 ? (Date.parse(last.date) - Date.parse(sorted[0].date)) / (365.25 * 86_400_000) : 0
  return {
    pe: stats(sorted.map((r) => r.PER), last ? last.PER || null : null),
    pb: stats(sorted.map((r) => r.PBR), last ? last.PBR || null : null),
    dividendYield: last ? last.dividend_yield : null,
    years: Math.round(years * 10) / 10,
  }
}

export interface ValuationAssumptions {
  // Annual EPS growth used for next year's earnings (%).
  growthPercent?: number
  // Multiples for the bear / base / bull cases (P/E, or P/B when used).
  multiples?: [number, number, number]
}

export interface FairValues {
  method: 'pe' | 'pb'
  growthPercent: number
  multiples: [number, number, number]
  bear: number
  base: number
  bull: number
}

export const GROWTH_BOUNDS = { min: -10, max: 20 } as const

// Three scenarios from the stock's own five-year range of multiples:
// bear = earnings without growth × 20th-percentile P/E; base = next year's
// earnings × median P/E; bull = next year's earnings × 80th-percentile P/E.
// Loss-making companies and financials use book value × P/B instead.
export function fairValues(
  input: { epsTtm: number | null; epsCagr3y: number | null; isFinancial: boolean; price: number | null; valuation: ValuationStats },
  assumptions: ValuationAssumptions = {},
): FairValues | null {
  const { valuation } = input
  const usePe = !input.isFinancial && input.epsTtm !== null && input.epsTtm > 0 && valuation.pe !== null
  const round = (v: number) => Math.round(v * 100) / 100
  if (usePe) {
    const g = assumptions.growthPercent ?? Math.min(Math.max(input.epsCagr3y ?? 0, GROWTH_BOUNDS.min), GROWTH_BOUNDS.max)
    const m = assumptions.multiples ?? [valuation.pe!.p20, valuation.pe!.p50, valuation.pe!.p80]
    const eps = input.epsTtm!
    const next = eps * (1 + g / 100)
    return { method: 'pe', growthPercent: round(g), multiples: m, bear: round(Math.min(eps, next) * m[0]), base: round(next * m[1]), bull: round(next * m[2]) }
  }
  const pb = valuation.pb
  if (!pb || !pb.current || !input.price) return null
  const bvps = input.price / pb.current
  const m = assumptions.multiples ?? [pb.p20, pb.p50, pb.p80]
  return { method: 'pb', growthPercent: 0, multiples: m, bear: round(bvps * m[0]), base: round(bvps * m[1]), bull: round(bvps * m[2]) }
}

const CYCLICAL_INDUSTRIES = ['鋼鐵', '塑膠', '航運', '水泥', '化學', '橡膠', '造紙', '玻璃', '油電燃氣', '光電']

// Peter Lynch's six categories, suggested from the numbers; the user can
// change it.
export function suggestLynch(health: StockHealth, industry: string, pbCurrent: number | null): LynchCategory {
  if (health.epsTtmPrev !== null && health.epsTtmPrev <= 0 && (health.epsTtm ?? 0) > 0) return 'turnaround'
  if (CYCLICAL_INDUSTRIES.some((w) => industry.includes(w))) return 'cyclical'
  if (pbCurrent !== null && pbCurrent < 0.8) return 'asset_play'
  // Financials' earnings swing with markets; growth rates mislead.
  if (health.isFinancial) return 'stalwart'
  const g = health.epsCagr3y
  if (g !== null && g > 20) return 'fast_grower'
  if (g !== null && g >= 10) return 'stalwart'
  return 'slow_grower'
}
