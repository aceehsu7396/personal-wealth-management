// Builds src/lib/demo/demo-data.json: a complete worked example (handbook
// chapter 12) from real FinMind prices and the app's own functions — from
// a research card and a strategy card through backtest, ten months of paper
// trading and a year of real trades, to quarterly attribution.
//
//   npx tsx scripts/demo-data.mts
//
// Run once by hand; the JSON is committed so the site never fetches it.
import { writeFileSync } from 'node:fs'
import { createDefaultAppData, type AppData, type Holding, type MacroCheckIn, type PaperAccount, type PerformanceReview, type Sleeve, type Trade } from '../src/lib/storage/schema.ts'
import { requestDataset } from '../src/lib/research/finmind.ts'
import { buildAutoResearch, derivedFields } from '../src/lib/research/autoResearch.ts'
import { loadChipFlows } from '../src/lib/research/chips.ts'
import { adjustBars, detectSplits, type Bar } from '../src/lib/market/priceHistory.ts'
import { benchmarkInput, latestSignals, marketCosts, runBacktest, splitStats, weeklySample, type ChipSeries } from '../src/lib/backtest/engine.ts'
import { atr } from '../src/lib/backtest/indicators.ts'
import { placeOrder, updatePrices } from '../src/lib/paper/paperAccount.ts'
import { buildPreTradeChecklist, type PendingTrade } from '../src/lib/calculations/preTradeChecklist.ts'
import { assessMacro } from '../src/lib/calculations/macroRegime.ts'

const OUT = 'src/lib/demo/demo-data.json'
const END = '2026-10-30'
const STOCK = '2330'
const SYMBOL = `TW:${STOCK}`
const CORE: { code: string; name: string; sleeve: Sleeve; weight: number }[] = [
  { code: '006208', name: '富邦台50', sleeve: 'core_tw', weight: 25 },
  { code: '00646', name: '元大S&P500', sleeve: 'core_global', weight: 35 },
  { code: '00679B', name: '元大美債20年', sleeve: 'core_bond_cash', weight: 10 },
]
const MONTHLY_DCA = 50_000
const START_VALUE = { core_tw: 1_600_000, core_global: 2_200_000, core_bond_cash: 650_000 } as Record<string, number>
const ids = (() => {
  let n = 0
  return (p: string) => `demo-${p}-${++n}`
})()

interface Series {
  raw: Bar[]
  adjusted: Bar[]
  close: Map<string, number>
}

async function series(code: string): Promise<Series> {
  const prices = await requestDataset<{ date: string; open: number; max: number; min: number; close: number; Trading_Volume: number }>('TaiwanStockPrice', code, '2013-06-01')
  const divs = await requestDataset<{ CashExDividendTradingDate?: string; CashEarningsDistribution?: number; CashStatutorySurplus?: number }>('TaiwanStockDividend', code, '2008-01-01')
  const raw: Bar[] = prices
    .filter((p) => p.close > 0 && p.date <= END)
    .map((p) => ({ date: p.date, open: p.open || p.close, high: p.max || p.close, low: p.min || p.close, close: p.close, volume: p.Trading_Volume }))
  const events: { date: string; factor: number }[] = []
  for (const d of divs) {
    const cash = (d.CashEarningsDistribution ?? 0) + (d.CashStatutorySurplus ?? 0)
    if (!cash || !d.CashExDividendTradingDate) continue
    const i = raw.findIndex((b) => b.date >= d.CashExDividendTradingDate!)
    if (i > 0) events.push({ date: raw[i].date, factor: (raw[i - 1].close - cash) / raw[i - 1].close })
  }
  return { raw, adjusted: adjustBars(raw, [...events, ...detectSplits(raw, events)]), close: new Map(raw.map((b) => [b.date, b.close])) }
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const iso = (date: string, h = '06:00:00') => `${date}T${h}.000Z`

const stock = await series(STOCK)
const core = Object.fromEntries(await Promise.all(CORE.map(async (c) => [c.code, await series(c.code)] as const)))
const flows = await loadChipFlows(STOCK, '2013-06-01')
const chips: Record<string, ChipSeries> = { [SYMBOL]: Object.fromEntries(flows.map(([d, f]) => [d, f])) }
const days = stock.raw.map((b) => b.date)
const closeOn = (s: Series, date: string) => {
  let v = s.close.get(date)
  for (let i = days.indexOf(date); v === undefined && i > 0; i--) v = s.close.get(days[i - 1])
  return v ?? s.raw[0].close
}

const data: AppData = createDefaultAppData()
data.profile = { currentAge: 38, currency: 'TWD', updatedAt: iso('2024-12-01') }
data.assumptions = {
  ...data.assumptions,
  monthlyIncome: 150_000,
  savingsMode: 'amount',
  monthlySavingsAmount: MONTHLY_DCA,
  monthlyExpenses: 60_000,
  expectedAnnualReturnPercent: 6,
  expectedInflationPercent: 2,
  safeWithdrawalRatePercent: 3.5,
  updatedAt: iso('2024-12-01'),
}
data.foundation = { emergencyFundAmount: 1_500_000, emergencyFundTargetMonths: 6, livingBufferMonths: 24 }
data.investmentPolicy = { ...data.investmentPolicy, signedAt: iso('2024-12-15'), updatedAt: iso('2024-12-15') }

// Monthly macro reviews (illustrative signals; the app fills real ones
// from the Fubon report). April 2025 is the tariff sell-off.
function macroOn(date: string, month: number): MacroCheckIn {
  const panic = date.startsWith('2025-04')
  const up = month % 4 !== 3
  return {
    id: ids('macro'),
    date,
    growth: { usPmi: up ? 'up' : 'flat', usEmployment: 'flat', twBusinessSignal: 'up', twExportOrders: up ? 'up' : 'flat' },
    inflation: { usCpi: month % 3 === 0 ? 'flat' : 'down', twCpi: 'flat' },
    liquidity: { policyRate: 1, yieldCurve: 1, creditSpread: panic ? -1 : 0, centralBankBalanceSheet: 0, usDollar: month % 2 ? 1 : 0 },
    sentiment: panic
      ? { valuation: -1, credit: -1, ipoHype: -1, media: -1, margin: -1, vix: -1 }
      : { valuation: 1, credit: 0, ipoHype: 0, media: 0, margin: 0, vix: 0 },
    note: panic ? '關稅衝擊，情緒極度恐慌（示範）' : '示範資料：簡化的總經訊號',
    createdAt: iso(date),
  }
}
const monthEnds: string[] = []
for (let i = 1; i < days.length; i++) if (days[i].slice(0, 7) !== days[i - 1].slice(0, 7) && days[i - 1] >= '2024-12-01') monthEnds.push(days[i - 1])
monthEnds.push(END)
data.macroCheckIns = monthEnds.map((d, i) => macroOn(d, i))
const macroAt = (date: string) => {
  const m = [...data.macroCheckIns].filter((c) => c.date <= date).pop()
  return m ? assessMacro(m, data.guardrails) : null
}

// Step 3: the screener puts TSMC on the watchlist.
data.watchlist = [{ symbol: SYMBOL, name: '台積電', industry: '半導體業', priceAtAdd: closeOn(stock, '2024-12-05'), source: '大型權值', note: '全球晶圓代工龍頭，想研究能否用籌碼控制回撤', addedAt: iso('2024-12-05') }]

// Step 4: the research card (today's automatic health check).
const auto = await buildAutoResearch(STOCK, END)
const thesisId = 'demo-thesis-2330'
data.stockTheses = [
  {
    id: thesisId,
    ticker: STOCK,
    name: auto.name,
    market: 'TW',
    sector: auto.industry,
    lynchCategory: auto.stock?.lynch ?? 'stalwart',
    inCircleOfCompetence: true,
    // Not held at the end: the last real trade is a strategy exit.
    status: 'watch',
    thesis: '',
    drivers: '',
    killCriteria: '',
    sources: '',
    preMortem: '',
    fiveForces: { rivalry: 3, newEntrants: 3, substitutes: 3, buyerPower: 3, supplierPower: 3 },
    powers: { scaleEconomies: 0, networkEconomies: 0, counterPositioning: 0, switchingCosts: 0, branding: 0, corneredResource: 0, processPower: 0 },
    kind: 'stock',
    auto,
    ...derivedFields(auto, undefined, { receivables: '擴產備料與 AI 客戶延長付款，營收持續成長（示範說明）' }),
    explainedFlags: { receivables: '擴產備料與 AI 客戶延長付款，營收持續成長（示範說明）' },
    verdict: 'invest',
    verdictNote: '體質佳、能力圈內；個股集中，用外資籌碼濾網控制回撤（示範）',
    verdictAt: '2024-12-12',
    fiveForcesRated: false,
    createdAt: iso('2024-12-12'),
    updatedAt: iso(END),
  },
]

// Step 5: the strategy card and its backtest (2015–2024, 30% out of sample).
const strategyId = 'demo-strategy-chip'
const params = { flowDays: 20, trendDays: 0, atrStop: 0 }
data.tradingStrategies = [
  {
    id: strategyId,
    name: '台積電外資籌碼濾網',
    template: 'chip_flow',
    params,
    symbols: [SYMBOL],
    edge: '外資連續賣出的期間，台積電常有較深的回檔；外資近 20 日淨買超才持有，目的是少賠。',
    entryRules: '外資近 20 日累計淨買超 > 0，隔日開盤買進；實單另設 2.5 倍 ATR 保護停損',
    exitRules: '外資近 20 日累計轉為淨賣超，隔日開盤賣出',
    riskPerTradePercent: 1,
    status: 'live',
    notes: '示範：2025-01～10 虛擬交易，2025-11 起實單。',
    createdAt: iso('2024-12-20'),
    updatedAt: iso('2025-11-03'),
  },
]
const btInput = {
  template: 'chip_flow' as const,
  params,
  data: { [SYMBOL]: stock.adjusted },
  start: '2015-01-02',
  end: '2024-12-31',
  initialCapital: 1_000_000,
  costs: marketCosts(0.28, 0),
  sizing: { mode: 'equal' as const, riskPercent: 1 },
  chips,
}
const bt = runBacktest(btInput)
const bh = runBacktest(benchmarkInput(btInput))
const st = splitStats(bt, 0.3)
const bs = splitStats(bh, 0.3)
const strip = (s: typeof st) => ({ full: s.full, inSample: s.inSample, outOfSample: s.outOfSample })
data.backtestRuns = [
  {
    id: 'demo-backtest',
    strategyId,
    label: '台積電外資籌碼濾網',
    template: 'chip_flow',
    params,
    symbols: [SYMBOL],
    start: btInput.start,
    end: btInput.end,
    initialCapital: btInput.initialCapital,
    outOfSampleStart: st.splitIndex !== null ? bt.dates[st.splitIndex] : null,
    dividendAdjusted: true,
    stats: strip(st),
    benchmark: strip(bs),
    equity: weeklySample(bt.dates, bt.index, bh.index).map((p) => ({ date: p.date, strategy: p.values[0] * 100, benchmark: p.values[1] * 100 })),
    createdAt: iso('2024-12-31'),
  },
]

// Signals on each trading day from the bars known by its close.
function signalsOn(date: string, held: { shares: number; openedAt: string } | null, equity: number) {
  const known = stock.adjusted.filter((b) => b.date <= date)
  return latestSignals('chip_flow', params, { [SYMBOL]: known }, held ? { [SYMBOL]: held } : {}, equity, chips)
}

// Step 6: ten months of paper trading by the signals.
let paper: PaperAccount = {
  id: 'demo-paper',
  name: '台積電籌碼・虛擬',
  strategyId,
  market: 'TW',
  initialCash: 1_000_000,
  cash: 1_000_000,
  positions: [],
  orders: [],
  equityHistory: [],
  createdAt: iso('2025-01-02'),
}
for (const d of days.filter((x) => x >= '2025-01-02' && x <= '2025-10-31')) {
  const bar = stock.raw.find((b) => b.date === d)!
  paper = updatePrices(paper, { [SYMBOL]: { price: bar.close, date: d, open: bar.open, high: bar.high, low: bar.low } })
  const pos = paper.positions[0]
  const equity = paper.cash + (pos ? pos.shares * pos.lastPrice : 0)
  for (const sg of signalsOn(d, pos ? { shares: pos.shares, openedAt: pos.openedAt } : null, equity)) {
    const shares = sg.side === 'buy' ? Math.floor((paper.cash * 0.99) / bar.close) : pos!.shares
    if (shares <= 0) continue
    paper = placeOrder(
      paper,
      { symbol: SYMBOL, name: '台積電', side: sg.side, type: 'market', shares, reason: `策略訊號：${sg.side === 'buy' ? '外資 20 日轉為買超' : '外資 20 日轉為賣超'}`, emotion: sg.side === 'buy' ? 3 : 2 },
      { price: bar.close, date: d },
      iso(d),
    )
  }
}
data.paperAccounts = [paper]

// Core holdings bought before the example starts, then monthly DCA.
const holdings = new Map<string, Holding>()
for (const c of CORE) {
  const price = closeOn(core[c.code], '2024-12-31')
  const shares = Math.floor(START_VALUE[c.sleeve] / price)
  holdings.set(c.code, {
    id: `demo-holding-${c.code}`,
    ticker: c.code,
    name: c.name,
    kind: 'security',
    sleeve: c.sleeve,
    currency: 'TWD',
    shares,
    avgCost: price,
    currentPrice: price,
    priceUpdatedAt: '2024-12-31',
    createdAt: iso('2024-12-31'),
  })
}
const valueOn = (date: string) =>
  [...holdings.values()].reduce((a, h) => a + h.shares * closeOn(h.ticker === STOCK ? stock : core[h.ticker], date), 0)

const trades: Trade[] = []
const manualFor = (pending: PendingTrade, ctx: Parameters<typeof buildPreTradeChecklist>[1]) =>
  Object.fromEntries(buildPreTradeChecklist(pending, ctx, {}).filter((c) => c.manual).map((c) => [c.key, true]))

function record(date: string, pendingIn: PendingTrade, emotion: number, biasNotes: string) {
  const pending = { ...pendingIn, biasNotes }
  // Checks run on that day's prices.
  for (const [k, h] of holdings) holdings.set(k, { ...h, currentPrice: closeOn(k === STOCK ? stock : core[k], date) })
  const ctx = {
    holdings: [...holdings.values()],
    theses: data.stockTheses,
    policy: { ...data.investmentPolicy, satellitePercent: 10 },
    guardrails: data.guardrails,
    meta: data.portfolioMeta,
    macro: macroAt(date),
    strategies: data.tradingStrategies,
  }
  const checklist = buildPreTradeChecklist(pending, ctx, manualFor(pending, ctx))
  const failed = checklist.filter((c) => !c.passed)
  trades.push({
    id: ids('trade'),
    date,
    ticker: pending.ticker,
    name: pending.name,
    holdingId: pending.holdingId,
    thesisId: pending.thesisId,
    strategyId: pending.strategyId,
    stopLoss: pending.stopLoss,
    side: pending.side,
    reason: pending.reason,
    shares: pending.shares,
    price: pending.price,
    currency: 'TWD',
    checklist: checklist.map(({ key, label, passed }) => ({ key, label, passed })),
    exceptionReason: failed.length ? `示範：${failed.map((c) => c.label).join('、')}` : undefined,
    emotion,
    biasNotes,
    createdAt: iso(date, '07:00:00'),
  })
  // Apply to holdings (average cost includes nothing but the price here).
  const key = pending.ticker
  const h = holdings.get(key)
  if (pending.side === 'buy') {
    if (h) holdings.set(key, { ...h, avgCost: (h.avgCost * h.shares + pending.price * pending.shares) / (h.shares + pending.shares), shares: h.shares + pending.shares })
    else
      holdings.set(key, {
        id: pending.holdingId ?? `demo-holding-${key}`,
        ticker: key,
        name: pending.name,
        kind: 'security',
        sleeve: pending.sleeve,
        currency: 'TWD',
        shares: pending.shares,
        avgCost: pending.price,
        currentPrice: pending.price,
        thesisId: pending.thesisId,
        strategyId: pending.strategyId,
        createdAt: iso(date),
      })
  } else if (h) holdings.set(key, { ...h, shares: h.shares - pending.shares })
}

const firstDays = days.filter((d, i) => d >= '2025-01-02' && d <= END && (i === 0 || d.slice(0, 7) !== days[i - 1].slice(0, 7)))
const liveDays = days.filter((d) => d >= '2025-11-03' && d <= END)
const stockAtr = atr(stock.raw, 14)
for (const d of days.filter((x) => x >= '2025-01-02' && x <= END)) {
  if (firstDays.includes(d)) {
    for (const c of CORE) {
      const price = closeOn(core[c.code], d)
      const shares = Math.floor((MONTHLY_DCA * c.weight) / 70 / price)
      const h = holdings.get(c.code)!
      record(d, { side: 'buy', reason: 'core_dca', ticker: c.code, name: c.name, sleeve: c.sleeve, currency: 'TWD', shares, price, holdingId: h.id, biasNotes: '' }, 3, '定期定額，不看價格')
    }
  }
  if (!liveDays.includes(d)) continue
  // Step 7: real trades by the same signals, sized by the 1% risk rule.
  const h = holdings.get(STOCK)
  const held = h && h.shares > 0 ? { shares: h.shares, openedAt: trades.filter((t) => t.ticker === STOCK && t.side === 'buy').at(-1)?.date ?? d } : null
  const total = valueOn(d)
  for (const sg of signalsOn(d, held, total)) {
    const i = stock.raw.findIndex((b) => b.date === d)
    // Signals fire at the close; the order fills at the next open.
    const next = stock.raw[i + 1]
    if (!next || next.date > END) continue
    const price = next.open
    if (sg.side === 'buy') {
      const stop = round(stock.raw[i].close - 2.5 * stockAtr[i], 1)
      const budget = total * 0.1 * 0.01
      // 1% risk of the trading budget, and the sector cap: one stock may
      // take at most 25% of the trading budget (10% of the portfolio).
      const shares = Math.min(Math.floor(budget / (price - stop)), Math.floor((total * 0.1 * 0.25 * 0.98) / price))
      if (shares <= 0) continue
      record(next.date, { side: 'buy', reason: 'strategy_entry', ticker: STOCK, name: '台積電', sleeve: 'satellite_tw', currency: 'TWD', shares, price, holdingId: h?.id ?? 'demo-holding-2330', thesisId, strategyId, stopLoss: stop, biasNotes: '' }, 3, '依策略卡訊號：外資 20 日轉為買超；停損 2.5 倍 ATR，風險 ≤ 交易部位 1%')
    } else if (held) {
      record(next.date, { side: 'sell', reason: 'strategy_exit', ticker: STOCK, name: '台積電', sleeve: 'satellite_tw', currency: 'TWD', shares: held.shares, price, holdingId: h!.id, thesisId, strategyId, biasNotes: '' }, 2, '依策略卡訊號：外資 20 日轉為賣超，照規則出場')
    }
  }
}

// Post-trade reviews for real trades older than six months.
for (const t of trades) {
  if (t.reason !== 'strategy_entry' && t.reason !== 'strategy_exit') continue
  const due = new Date(`${t.date}T00:00:00Z`)
  due.setUTCMonth(due.getUTCMonth() + 6)
  if (due.toISOString().slice(0, 10) > END) continue
  const later = closeOn(stock, due.toISOString().slice(0, 10))
  t.review6m = {
    reviewedAt: iso(due.toISOString().slice(0, 10)),
    outcomeNote: `6 個月後股價 ${later}（成交 ${round(t.price, 1)}，${later >= t.price ? '上漲' : '下跌'} ${round(Math.abs(later / t.price - 1) * 100, 1)}%）`,
    decisionQuality: 4,
    lesson: t.side === 'buy' ? '照訊號進場、停損事先設定；結果好壞不影響決策品質的評分。' : '照規則出場，沒有因為捨不得而拖延。',
  }
}
data.trades = trades

// Step 8: quarterly attribution from the holdings at each quarter end.
function sleeveValues(date: string) {
  const out: Record<string, number> = {}
  const sharesAt = new Map<string, number>()
  for (const c of CORE) sharesAt.set(c.code, Math.floor(START_VALUE[c.sleeve] / closeOn(core[c.code], '2024-12-31')))
  for (const t of trades.filter((x) => x.date <= date)) sharesAt.set(t.ticker, (sharesAt.get(t.ticker) ?? 0) + (t.side === 'buy' ? t.shares : -t.shares))
  for (const [code, sh] of sharesAt) {
    const sleeve = code === STOCK ? 'satellite_tw' : CORE.find((c) => c.code === code)!.sleeve
    out[sleeve] = (out[sleeve] ?? 0) + sh * closeOn(code === STOCK ? stock : core[code], date)
  }
  return out
}
// Price returns, like the holding values (which leave out cash dividends),
// so dividends do not show up as a selection effect.
const adjReturn = (s: Series, a: string, b: string) => round((closeOn(s, b) / closeOn(s, a) - 1) * 100, 2)
const quarters: [string, string][] = [
  ['2025-10-01', '2025-12-31'],
  ['2026-01-01', '2026-03-31'],
  ['2026-04-01', '2026-06-30'],
  ['2026-07-01', '2026-09-30'],
]
const reviews: PerformanceReview[] = []
for (const [a, b] of quarters) {
  const before = days.filter((d) => d < a).pop()!
  const startV = sleeveValues(before)
  const endV = sleeveValues(b)
  const flow: Record<string, number> = {}
  for (const t of trades.filter((x) => x.date >= a && x.date <= b)) {
    const sleeve = t.ticker === STOCK ? 'satellite_tw' : CORE.find((c) => c.code === t.ticker)!.sleeve
    flow[sleeve] = (flow[sleeve] ?? 0) + (t.side === 'buy' ? 1 : -1) * t.shares * t.price
  }
  const sleeves = ['core_tw', 'core_global', 'core_bond_cash', 'satellite_tw'].map((s) => ({
    sleeve: s as Sleeve,
    startValue: Math.round(startV[s] ?? 0),
    endValue: Math.round(endV[s] ?? 0),
    netFlow: Math.round(flow[s] ?? 0),
  }))
  reviews.push({
    id: ids('review'),
    periodStart: a,
    periodEnd: b,
    sleeves,
    benchmarkReturns: { tw: adjReturn(core['006208'], before, b), global: adjReturn(core['00646'], before, b), bondCash: adjReturn(core['00679B'], before, b) },
    note: '示範：市值依季末收盤價計算，基準也用價格報酬，兩者都未計入現金股利。',
    createdAt: iso(b),
  })
}
data.performanceReviews = reviews

// Final holdings, snapshots and net worth.
data.holdings = [...holdings.values()].map((h) => ({
  ...h,
  currentPrice: closeOn(h.ticker === STOCK ? stock : core[h.ticker], END),
  priceUpdatedAt: END,
}))
data.portfolioSnapshots = monthEnds.filter((d) => d >= '2025-01-01').map((d) => ({ month: d.slice(0, 7), date: d, valueTwd: Math.round(Object.values(sleeveValues(d)).reduce((x, y) => x + y, 0)) }))
const peak = data.portfolioSnapshots.reduce((p, s) => (s.valueTwd > p.valueTwd ? s : p))
data.portfolioMeta = { fxUsdTwd: 32.5, peakValueTwd: peak.valueTwd, peakDate: peak.date }
data.assumptions.currentNetWorth = data.portfolioSnapshots.at(-1)!.valueTwd

writeFileSync(OUT, JSON.stringify(data))
const fills = paper.orders.filter((o) => o.status === 'filled')
console.log(JSON.stringify({
  backtest: { full: st.full, oos: st.outOfSample, bhOos: bs.outOfSample, bhFull: bs.full, oosStart: data.backtestRuns[0].outOfSampleStart },
  paper: { fills: fills.length, cash: Math.round(paper.cash), equity: paper.equityHistory.at(-1), orders: fills.map((o) => `${o.filledAt} ${o.side} ${o.shares}@${o.fillPrice} ${o.rMultiple ?? ''} ${o.realizedPnl ? Math.round(o.realizedPnl) : ''}`) },
  live: trades.filter((t) => t.ticker === STOCK).map((t) => `${t.date} ${t.side} ${t.shares}@${t.price} stop ${t.stopLoss ?? ''} fails ${t.checklist.filter((c) => !c.passed).map((c) => c.key).join(',')}`),
  dcaTrades: trades.filter((t) => t.reason === 'core_dca').length,
  reviews: reviews.map((r) => ({ p: `${r.periodStart}~${r.periodEnd}`, s: r.sleeves, b: r.benchmarkReturns })),
  holdings: data.holdings.map((h) => `${h.ticker} ${h.shares}@${h.currentPrice} avg ${round(h.avgCost, 2)}`),
  netWorth: data.assumptions.currentNetWorth,
  auto: { price: auto.price, fair: [data.stockTheses[0].fairValueBear, data.stockTheses[0].fairValueBase, data.stockTheses[0].fairValueBull], fScore: auto.stock?.fScore?.score, roe: auto.stock?.roe, chips: auto.chips },
}, null, 1))
