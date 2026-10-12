import type { Bar } from '../market/priceHistory'
import type { BacktestStats, StrategyTemplate } from '../storage/schema'
import { atr, priorHigh, priorLow, rsi, sma } from './indicators'
import { parseSymbol, resolveParams, STRATEGY_TEMPLATES } from './templates'

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

// Per-symbol trading costs (fee rate and minimum fee on both sides, plus
// a transaction tax on sells).
export interface BacktestCosts {
  feeRate: (symbol: string) => number
  minFee: (symbol: string) => number
  taxRate: (symbol: string) => number
}

// Taiwan: 0.1425% commission times the broker discount (NT$20 minimum),
// securities transaction tax 0.3% for stocks and 0.1% for ETFs (codes
// starting with "00"). US: commission as entered, no transaction tax.
export function marketCosts(twFeeDiscount = 1, usFeePercent = 0): BacktestCosts {
  const isUs = (symbol: string) => parseSymbol(symbol).market === 'US'
  return {
    feeRate: (symbol) => (isUs(symbol) ? usFeePercent / 100 : 0.001425 * twFeeDiscount),
    minFee: (symbol) => (isUs(symbol) ? 0 : 20),
    taxRate: (symbol) => {
      const { market, code } = parseSymbol(symbol)
      if (market === 'US') return 0
      return code.startsWith('00') ? 0.001 : 0.003
    },
  }
}

export type SizingMode = 'equal' | 'risk'

export interface BacktestInput {
  template: StrategyTemplate
  params: Record<string, number>
  // Adjusted daily bars per symbol; bars before `start` warm up indicators.
  data: Record<string, Bar[]>
  start: string
  end: string
  initialCapital: number
  costs: BacktestCosts
  sizing: { mode: SizingMode; riskPercent: number }
}

export type ExitReason = 'signal' | 'stop' | 'rotation' | 'end'

export interface ClosedTrade {
  symbol: string
  entryDate: string
  entryPrice: number
  exitDate: string
  exitPrice: number
  shares: number
  pnl: number
  returnPct: number
  // Profit in units of the initial risk (entry − stop), when a stop was set.
  rMultiple: number | null
  exitReason: ExitReason
}

export interface BacktestResult {
  dates: string[]
  equity: number[]
  // External cash added on each date (DCA contributions).
  flows: number[]
  // Time-weighted return index (starts at 1); flows do not count as returns.
  index: number[]
  invested: boolean[]
  trades: ClosedTrade[]
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface Position {
  shares: number
  entryPrice: number
  entryDate: string
  entryBar: number
  stop: number | null
  // Total cost including the buy fee, for P&L.
  cost: number
}

interface SymbolData {
  bars: Bar[]
  at: Map<string, number>
  closes: number[]
  atr: number[]
  ind: Record<string, number[]>
}

type Pending = { side: 'buy' | 'sell'; reason: ExitReason; atrAtSignal?: number }

function prepare(template: StrategyTemplate, params: Record<string, number>, bars: Bar[]): SymbolData {
  const closes = bars.map((b) => b.close)
  const ind: Record<string, number[]> = {}
  if (template === 'ma_cross') {
    ind.fast = sma(closes, params.fast)
    ind.slow = sma(closes, params.slow)
  } else if (template === 'donchian') {
    ind.high = priorHigh(bars, params.entryDays)
    ind.low = priorLow(bars, params.exitDays)
  } else if (template === 'rsi_reversion') {
    ind.rsi = rsi(closes, params.rsiDays)
    ind.trend = sma(closes, params.trendDays)
  }
  return { bars, at: new Map(bars.map((b, i) => [b.date, i])), closes, atr: atr(bars), ind }
}

// Entry/exit rules evaluated at the close of bar i.
function signal(
  template: StrategyTemplate,
  params: Record<string, number>,
  d: SymbolData,
  i: number,
  pos: Position | undefined,
): Pending | null {
  const { ind, closes } = d
  if (template === 'ma_cross') {
    const [f, s, f0, s0] = [ind.fast[i], ind.slow[i], ind.fast[i - 1], ind.slow[i - 1]]
    if ([f, s, f0, s0].some(Number.isNaN)) return null
    if (!pos && f > s && f0 <= s0) return { side: 'buy', reason: 'signal', atrAtSignal: d.atr[i] }
    if (pos && f < s) return { side: 'sell', reason: 'signal' }
  } else if (template === 'donchian') {
    if (!pos && closes[i] > ind.high[i]) return { side: 'buy', reason: 'signal', atrAtSignal: d.atr[i] }
    if (pos && closes[i] < ind.low[i]) return { side: 'sell', reason: 'signal' }
  } else if (template === 'rsi_reversion') {
    const r = ind.rsi[i]
    if (Number.isNaN(r) || Number.isNaN(ind.trend[i])) return null
    if (!pos && closes[i] > ind.trend[i] && r < params.entryBelow) {
      return { side: 'buy', reason: 'signal', atrAtSignal: d.atr[i] }
    }
    if (pos && (r > params.exitAbove || i - pos.entryBar >= params.maxHoldDays)) return { side: 'sell', reason: 'signal' }
  }
  return null
}

function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const { template, costs } = input
  const params = resolveParams(template, input.params)
  const symbols = Object.keys(input.data).filter((s) => input.data[s].length > 0)
  const data = Object.fromEntries(symbols.map((s) => [s, prepare(template, params, input.data[s])]))
  const dates = [...new Set(symbols.flatMap((s) => input.data[s].map((b) => b.date)))]
    .filter((d) => d >= input.start && d <= input.end)
    .sort()

  const result: BacktestResult = { dates, equity: [], flows: [], index: [], invested: [], trades: [] }
  if (dates.length === 0 || symbols.length === 0) return result

  const isDca = template === 'dca'
  let cash = isDca ? 0 : input.initialCapital
  const positions = new Map<string, Position>()
  const lastClose = new Map<string, number>()
  let pending = new Map<string, Pending>()
  let rotationTarget: string[] | null = null
  const atrStop = params.atrStop ?? 0

  const fee = (symbol: string, value: number) =>
    value > 0 ? Math.max(costs.minFee(symbol), value * costs.feeRate(symbol)) : 0
  const sellCosts = (symbol: string, value: number) => fee(symbol, value) + value * costs.taxRate(symbol)

  const equityNow = () => {
    let total = cash
    for (const [s, p] of positions) total += p.shares * (lastClose.get(s) ?? p.entryPrice)
    return total
  }

  const buy = (symbol: string, price: number, budget: number, date: string, bar: number, atrValue?: number) => {
    let shares = Math.floor(budget / (price * (1 + costs.feeRate(symbol))))
    let stop: number | null = null
    if (atrStop > 0 && atrValue && atrValue > 0) {
      stop = price - atrStop * atrValue
      if (input.sizing.mode === 'risk') {
        const riskShares = Math.floor((equityNow() * input.sizing.riskPercent) / 100 / (atrStop * atrValue))
        shares = Math.min(shares, riskShares)
      }
    }
    while (shares > 0 && shares * price + fee(symbol, shares * price) > cash) shares -= 1
    if (shares <= 0) return
    const value = shares * price
    const buyFee = fee(symbol, value)
    cash -= value + buyFee
    const existing = positions.get(symbol)
    if (existing) {
      const total = existing.shares + shares
      positions.set(symbol, {
        ...existing,
        shares: total,
        entryPrice: (existing.entryPrice * existing.shares + value) / total,
        cost: existing.cost + value + buyFee,
      })
    } else {
      positions.set(symbol, { shares, entryPrice: price, entryDate: date, entryBar: bar, stop, cost: value + buyFee })
    }
  }

  const sell = (symbol: string, price: number, date: string, reason: ExitReason) => {
    const p = positions.get(symbol)
    if (!p) return
    const value = p.shares * price
    const proceeds = value - sellCosts(symbol, value)
    cash += proceeds
    positions.delete(symbol)
    const risk = p.stop !== null ? p.entryPrice - p.stop : null
    result.trades.push({
      symbol,
      entryDate: p.entryDate,
      entryPrice: p.entryPrice,
      exitDate: date,
      exitPrice: price,
      shares: p.shares,
      pnl: proceeds - p.cost,
      returnPct: proceeds / p.cost - 1,
      rMultiple: risk && risk > 0 ? (price - p.entryPrice) / risk : null,
      exitReason: reason,
    })
  }

  // Buy-and-hold and DCA know their first trade in advance: day one's open.
  if (template === 'buy_hold') for (const s of symbols) pending.set(s, { side: 'buy', reason: 'signal' })

  let index = 1
  let prevEquity = 0
  for (let t = 0; t < dates.length; t++) {
    const date = dates[t]
    let flow = 0
    if (isDca && (t === 0 || monthOf(date) !== monthOf(dates[t - 1]))) {
      flow = params.monthlyAmount
      cash += flow
      for (const s of symbols) pending.set(s, { side: 'buy', reason: 'signal' })
    }

    // 1. Orders from yesterday's close fill at today's open.
    if (rotationTarget) {
      for (const s of [...positions.keys()]) {
        const i = data[s].at.get(date)
        if (i !== undefined && !rotationTarget.includes(s)) sell(s, data[s].bars[i].open, date, 'rotation')
      }
      const fresh = rotationTarget.filter((s) => !positions.has(s) && data[s].at.has(date))
      const budget = fresh.length > 0 ? cash / fresh.length : 0
      for (const s of fresh) {
        const i = data[s].at.get(date)!
        buy(s, data[s].bars[i].open, budget, date, i)
      }
      rotationTarget = null
    }
    const due = [...pending.entries()].filter(([s]) => data[s].at.has(date))
    for (const [s, order] of due) {
      if (order.side === 'sell') sell(s, data[s].bars[data[s].at.get(date)!].open, date, order.reason)
    }
    // Buy-and-hold and DCA spread today's cash over the symbols; signal
    // strategies give each symbol an equal slot of current equity.
    const buys = due.filter(([, o]) => o.side === 'buy')
    const passive = isDca || template === 'buy_hold'
    const slot = passive ? cash / Math.max(buys.length, 1) : equityNow() / symbols.length
    for (const [s, order] of buys) {
      const i = data[s].at.get(date)!
      buy(s, data[s].bars[i].open, Math.min(slot, cash), date, i, order.atrAtSignal)
    }
    pending = new Map([...pending].filter(([s]) => !data[s].at.has(date)))

    // 2. Stops trigger intraday; a gap below the stop fills at the open.
    for (const [s, p] of [...positions]) {
      const i = data[s].at.get(date)
      if (i === undefined || p.stop === null) continue
      const bar = data[s].bars[i]
      if (bar.low <= p.stop) sell(s, Math.min(bar.open, p.stop), date, 'stop')
    }

    // 3. Close: mark to market, then decide tomorrow's orders.
    for (const s of symbols) {
      const i = data[s].at.get(date)
      if (i !== undefined) lastClose.set(s, data[s].bars[i].close)
    }
    const equity = equityNow()
    if (t > 0 && prevEquity > 0) index *= (equity - flow) / prevEquity
    prevEquity = equity
    result.equity.push(equity)
    result.flows.push(flow)
    result.index.push(index)
    result.invested.push(positions.size > 0)

    if (template === 'momentum_rotation') {
      const next = dates[t + 1]
      if (next && monthOf(next) !== monthOf(date)) rotationTarget = rankMomentum(params, data, date)
    } else if (!isDca && template !== 'buy_hold') {
      for (const s of symbols) {
        const i = data[s].at.get(date)
        if (i === undefined) continue
        const order = signal(template, params, data[s], i, positions.get(s))
        if (order) pending.set(s, order)
      }
    }
  }

  // Positions still open are closed at the last close for the trade stats.
  const lastDate = dates[dates.length - 1]
  for (const s of [...positions.keys()]) sell(s, lastClose.get(s)!, lastDate, 'end')
  return result
}

const TRADING_DAYS_PER_MONTH = 21

// Momentum rotation: top K by N-month return; with the absolute filter on,
// only positive momentum qualifies (otherwise stay in cash).
function rankMomentum(params: Record<string, number>, data: Record<string, SymbolData>, date: string): string[] {
  const lookback = params.lookbackMonths * TRADING_DAYS_PER_MONTH
  const scored = Object.entries(data)
    .map(([s, d]) => {
      const i = d.at.get(date)
      if (i === undefined || i < lookback) return null
      return { s, ret: d.closes[i] / d.closes[i - lookback] - 1 }
    })
    .filter((x): x is { s: string; ret: number } => x !== null)
    .filter((x) => !params.absoluteFilter || x.ret > 0)
    .sort((a, b) => b.ret - a.ret)
  return scored.slice(0, Math.max(1, params.topK)).map((x) => x.s)
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export function computeStats(result: BacktestResult, from: number, to: number): BacktestStats {
  const { dates, index, invested } = result
  const empty: BacktestStats = { totalReturn: 0, cagr: 0, maxDrawdown: 0, sharpe: null, trades: 0, winRate: null, profitFactor: null, exposure: 0 }
  if (to <= from || index.length === 0) return empty
  const base = index[from]
  const totalReturn = index[to] / base - 1
  const years = (Date.parse(dates[to]) - Date.parse(dates[from])) / (365.25 * 86_400_000)
  const cagr = years > 0 && totalReturn > -1 ? (1 + totalReturn) ** (1 / years) - 1 : 0

  let peak = base
  let maxDrawdown = 0
  const daily: number[] = []
  for (let i = from; i <= to; i++) {
    peak = Math.max(peak, index[i])
    maxDrawdown = Math.min(maxDrawdown, index[i] / peak - 1)
    if (i > from) daily.push(index[i] / index[i - 1] - 1)
  }
  const mean = daily.reduce((a, v) => a + v, 0) / Math.max(daily.length, 1)
  const sd = Math.sqrt(daily.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(daily.length - 1, 1))
  const sharpe = sd > 0 && daily.length > 20 ? (mean / sd) * Math.sqrt(252) : null

  const trades = result.trades.filter((tr) => tr.exitDate > dates[from] && tr.exitDate <= dates[to])
  const wins = trades.filter((tr) => tr.pnl > 0)
  const grossWin = wins.reduce((a, tr) => a + tr.pnl, 0)
  const grossLoss = -trades.filter((tr) => tr.pnl < 0).reduce((a, tr) => a + tr.pnl, 0)
  const exposed = invested.slice(from, to + 1).filter(Boolean).length

  return {
    totalReturn,
    cagr,
    maxDrawdown,
    sharpe,
    trades: trades.length,
    winRate: trades.length > 0 ? wins.length / trades.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    exposure: exposed / (to - from + 1),
  }
}

export interface StatsSplit {
  full: BacktestStats
  inSample: BacktestStats | null
  outOfSample: BacktestStats | null
  splitIndex: number | null
}

// The last `oosFraction` of the period is held out: parameters are judged
// on it only after they were chosen on the earlier part.
export function splitStats(result: BacktestResult, oosFraction: number): StatsSplit {
  const n = result.dates.length
  const full = computeStats(result, 0, n - 1)
  if (oosFraction <= 0 || n < 40) return { full, inSample: null, outOfSample: null, splitIndex: null }
  const split = Math.floor((n - 1) * (1 - oosFraction))
  return {
    full,
    inSample: computeStats(result, 0, split),
    outOfSample: computeStats(result, split, n - 1),
    splitIndex: split,
  }
}

export function benchmarkInput(input: BacktestInput): BacktestInput {
  return { ...input, template: 'buy_hold', params: {}, sizing: { mode: 'equal', riskPercent: input.sizing.riskPercent } }
}

// ---------------------------------------------------------------------------
// Parameter sensitivity
// ---------------------------------------------------------------------------

export interface SensitivityCell {
  a: number
  b: number
  cagr: number
  maxDrawdown: number
  oosCagr: number | null
}

export interface SensitivityGrid {
  aLabel: string
  bLabel: string
  aValues: number[]
  bValues: number[]
  cells: SensitivityCell[]
}

function around(value: number, step: number, min: number, max: number): number[] {
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  return [...new Set([snap(value * 0.75), snap(value), snap(value * 1.25)])]
}

// Varies the first two parameters by ±25%: a robust strategy changes
// smoothly; one that only works at one setting is likely curve-fitted.
export function sensitivityGrid(input: BacktestInput, oosFraction: number): SensitivityGrid | null {
  const defs = STRATEGY_TEMPLATES[input.template].params
  if (defs.length < 2) return null
  const [pa, pb] = defs
  const params = resolveParams(input.template, input.params)
  const aValues = around(params[pa.key], pa.step, pa.min, pa.max)
  const bValues = around(params[pb.key], pb.step, pb.min, pb.max)
  const cells: SensitivityCell[] = []
  for (const a of aValues) {
    for (const b of bValues) {
      const r = runBacktest({ ...input, params: { ...params, [pa.key]: a, [pb.key]: b } })
      const s = splitStats(r, oosFraction)
      cells.push({ a, b, cagr: s.full.cagr, maxDrawdown: s.full.maxDrawdown, oosCagr: s.outOfSample?.cagr ?? null })
    }
  }
  return { aLabel: pa.label, bLabel: pb.label, aValues, bValues, cells }
}

// ---------------------------------------------------------------------------
// Core + trading mix
// ---------------------------------------------------------------------------

export interface MixRow {
  coreWeight: number
  cagr: number
  maxDrawdown: number
  sharpe: number | null
}

// Blends the core buy-and-hold index with the strategy index at each core
// weight, rebalancing every January.
export function coreTradingMix(strategy: BacktestResult, core: BacktestResult, step = 0.1): MixRow[] {
  const coreByDate = new Map(core.dates.map((d, i) => [d, core.index[i]]))
  const dates: string[] = []
  const s: number[] = []
  const c: number[] = []
  let lastCore: number | undefined
  strategy.dates.forEach((d, i) => {
    lastCore = coreByDate.get(d) ?? lastCore
    if (lastCore === undefined) return
    dates.push(d)
    s.push(strategy.index[i])
    c.push(lastCore)
  })
  const rows: MixRow[] = []
  for (let w = 0; w <= 1 + 1e-9; w += step) {
    const weight = Math.round(w * 100) / 100
    let core$ = weight
    let trade$ = 1 - weight
    const index = [1]
    for (let i = 1; i < dates.length; i++) {
      if (dates[i].slice(0, 4) !== dates[i - 1].slice(0, 4)) {
        const total = core$ + trade$
        core$ = total * weight
        trade$ = total * (1 - weight)
      }
      core$ *= c[i] / c[i - 1]
      trade$ *= s[i] / s[i - 1]
      index.push(core$ + trade$)
    }
    const stats = computeStats({ dates, equity: index, flows: [], index, invested: index.map(() => true), trades: [] }, 0, dates.length - 1)
    rows.push({ coreWeight: weight, cagr: stats.cagr, maxDrawdown: stats.maxDrawdown, sharpe: stats.sharpe })
  }
  return rows
}

// Weekly points for saving: the last trading day of each week.
export function weeklySample(dates: string[], ...series: number[][]): { date: string; values: number[] }[] {
  const out: { date: string; values: number[] }[] = []
  const week = (d: string) => Math.floor(Date.parse(d) / (7 * 86_400_000) + 3 / 7)
  dates.forEach((d, i) => {
    if (i === dates.length - 1 || week(dates[i + 1]) !== week(d)) out.push({ date: d, values: series.map((x) => x[i]) })
  })
  return out
}

// ---------------------------------------------------------------------------
// Today's signals (paper trading)
// ---------------------------------------------------------------------------

export interface SignalSuggestion {
  symbol: string
  side: 'buy' | 'sell'
  date: string
  close: number
  shares: number
  stopLoss?: number
  reason: string
}

// Applies a strategy's rules to the latest bar of each symbol, given what
// the paper account holds, and suggests orders for the next session.
export function latestSignals(
  template: StrategyTemplate,
  rawParams: Record<string, number>,
  data: Record<string, Bar[]>,
  held: Record<string, { shares: number; openedAt: string }>,
  equity: number,
): SignalSuggestion[] {
  const params = resolveParams(template, rawParams)
  const symbols = Object.keys(data).filter((s) => data[s].length > 0)
  if (symbols.length === 0) return []
  const prepared = Object.fromEntries(symbols.map((s) => [s, prepare(template, params, data[s])]))
  const out: SignalSuggestion[] = []
  const last = (s: string) => prepared[s].bars[prepared[s].bars.length - 1]
  const stopFor = (s: string) => {
    const d = prepared[s]
    const a = d.atr[d.bars.length - 1]
    return params.atrStop > 0 && a > 0 ? Math.round((last(s).close - params.atrStop * a) * 100) / 100 : undefined
  }

  if (template === 'momentum_rotation') {
    const date = symbols.map((s) => last(s).date).sort().pop()!
    const picks = rankMomentum(params, prepared, date)
    for (const s of symbols) {
      const bar = last(s)
      if (held[s] && !picks.includes(s)) {
        out.push({ symbol: s, side: 'sell', date: bar.date, close: bar.close, shares: held[s].shares, reason: '跌出動能前段班' })
      }
    }
    for (const s of picks.filter((p) => !held[p])) {
      const bar = last(s)
      out.push({ symbol: s, side: 'buy', date: bar.date, close: bar.close, shares: Math.floor(equity / picks.length / bar.close), reason: `動能前 ${params.topK} 名` })
    }
    return out
  }

  for (const s of symbols) {
    const d = prepared[s]
    const i = d.bars.length - 1
    const bar = d.bars[i]
    const h = held[s]
    if (template === 'buy_hold' || template === 'dca') {
      const amount = template === 'dca' ? params.monthlyAmount : equity / symbols.length
      if (template === 'dca' || !h) {
        out.push({ symbol: s, side: 'buy', date: bar.date, close: bar.close, shares: Math.floor(amount / bar.close), reason: template === 'dca' ? '每月定期定額' : '買進持有' })
      }
      continue
    }
    const entryBar = h ? Math.max(d.bars.findIndex((b) => b.date >= h.openedAt), 0) : 0
    const pos = h ? { shares: h.shares, entryPrice: 0, entryDate: h.openedAt, entryBar, stop: null, cost: 0 } : undefined
    const order = signal(template, params, d, i, pos)
    if (!order) continue
    if (order.side === 'sell' && h) {
      out.push({ symbol: s, side: 'sell', date: bar.date, close: bar.close, shares: h.shares, reason: '策略出場訊號' })
    } else if (order.side === 'buy') {
      out.push({
        symbol: s,
        side: 'buy',
        date: bar.date,
        close: bar.close,
        shares: Math.floor(equity / symbols.length / bar.close),
        stopLoss: stopFor(s),
        reason: '策略進場訊號',
      })
    }
  }
  return out
}
