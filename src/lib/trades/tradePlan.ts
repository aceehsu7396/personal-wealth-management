import type { InvestmentPolicy, PlanAdvice, StockThesis, Trade, TradePlan, TradingStrategy } from '../storage/schema'
import type { SignalReport } from '../research/signals'
import { VERDICT_LABELS } from '../calculations/thesisScoring'
import { buildPreTradeChecklist, riskLimitOf, type ChecklistContext, type PendingTrade } from '../calculations/preTradeChecklist'
import { addMonths, lateStopExits } from '../calculations/disciplineScore'
import { atr, sma } from '../backtest/indicators'
import { parseSymbol, resolveParams, STRATEGY_TEMPLATES } from '../backtest/templates'
import type { Bar } from '../market/priceHistory'

// The entry-exit assistant's rule layer (blueprint 02 §3): drafts a trade
// plan from a research card or a strategy card, checks it against the
// discipline rules in three levels, manages the stop while the position is
// open, and orders the day's work. Every number is computed here; nothing is
// typed in, and the trader decides.

export type PlanDraft = Omit<TradePlan, 'id' | 'createdAt' | 'updatedAt'>

const round2 = (v: number) => Math.round(v * 100) / 100
const fmt = (v: number) => v.toLocaleString('zh-TW', { maximumFractionDigits: 2 })

const blank = (over: Partial<PlanDraft> & Pick<PlanDraft, 'source' | 'ticker'>): PlanDraft => ({
  status: 'draft',
  name: '',
  market: 'TW',
  entryMethod: 'other',
  setup: '',
  trigger: '',
  confirmation: '',
  stopMethod: 'manual',
  orderType: 'limit',
  orderNote: '',
  trailing: 'none',
  targets: [],
  thesisExit: '',
  rules: [],
  advice: [],
  ...over,
})

// --- Drafts ------------------------------------------------------------------

// A blank plan for a trade that starts from neither card.
export function manualPlan(policy: InvestmentPolicy): PlanDraft {
  return blank({ source: 'manual', ticker: '', rules: [`投資政策：每筆停損風險 ${policy.riskPerTradePercent}%（占交易部位）`] })
}

export function planFromThesis(thesis: StockThesis, report: SignalReport, policy: InvestmentPolicy): PlanDraft {
  const level = (key: string) => report.levels.find((l) => l.key === key)?.price
  const verdict = thesis.verdict ? VERDICT_LABELS[thesis.verdict] : '待選'
  const stop = report.stopLoss ?? undefined
  const rules = [`投資政策：每筆停損風險 ${policy.riskPerTradePercent}%（占交易部位）`]
  if (stop) rules.push(`研究卡：建議停損 ${fmt(stop)}（現價 − 2.5 × ATR）`)

  if (thesis.kind === 'etf') {
    return blank({
      source: 'thesis',
      thesisId: thesis.id,
      ticker: thesis.ticker,
      name: thesis.name,
      market: thesis.market,
      setup: `研究卡結論「${verdict}」；${report.headline}`,
      trigger: '收盤站上 120 日線，且 12 個月報酬為正',
      confirmation: '交易部位的 ETF 才用此規則；核心部位照定期定額',
      stopLoss: stop,
      stopMethod: stop ? 'atr' : 'manual',
      entryPrice: thesis.currentPrice || undefined,
      trailing: 'moving_average',
      trailingParam: 120,
      thesisExit: '跌破 120 日線且 12 個月報酬轉負',
      orderNote: stop ? `限價買進；成交後設觸價停損 ${fmt(stop)}` : '限價買進；成交後設停損',
      rules: [...rules, '研究卡：ETF 看 120 日線與 12 個月動能'],
    })
  }

  const batch1 = level('batch1')
  const batch2 = level('batch2')
  const trim = level('trim')
  const exit = level('exit')
  const entry = batch1 && thesis.currentPrice > 0 ? Math.min(batch1, thesis.currentPrice) : batch1 ?? (thesis.currentPrice || undefined)
  if (batch1) rules.push(`研究卡：第 1 批 ${fmt(batch1)}${batch2 ? `、第 2 批 ${fmt(batch2)}` : ''}`)
  if (trim) rules.push(`研究卡：樂觀合理價 ${fmt(trim)} 減碼、${exit ? fmt(exit) : '再高 20%'} 出清`)
  return blank({
    source: 'thesis',
    thesisId: thesis.id,
    ticker: thesis.ticker,
    name: thesis.name,
    market: thesis.market,
    entryMethod: 'value_batches',
    setup: `研究卡結論「${verdict}」；${report.headline}`,
    trigger: batch1 ? `收盤 ≤ ${fmt(batch1)}（第 1 批）` : '進入研究卡的買進區',
    confirmation: '局勢不是危機；沒有跌破 20 日低點的破底走勢',
    stopLoss: stop,
    stopMethod: stop ? 'atr' : 'manual',
    entryPrice: entry ? round2(entry) : undefined,
    shares: report.suggestedShares ?? undefined,
    orderType: 'limit',
    orderNote: entry ? `限價 ${fmt(round2(entry))}；成交後立刻設觸價停損${stop ? ` ${fmt(stop)}` : ''}` : '限價買進；成交後立刻設停損',
    targets: [
      ...(trim ? [{ price: round2(trim), fraction: 1 / 3 }] : []),
      ...(exit ? [{ price: round2(exit), fraction: 1 }] : []),
    ],
    thesisExit: thesis.killCriteria,
    rules,
  })
}

const METHOD_OF: Partial<Record<TradingStrategy['template'], TradePlan['entryMethod']>> = {
  ma_cross: 'breakout',
  donchian: 'breakout',
  rsi_reversion: 'mean_reversion',
  momentum_rotation: 'momentum',
  chip_flow: 'breakout',
  dca: 'dca',
}

// Shares a stop allows: the trading budget's per-trade risk ÷ risk per share.
export function sharesByRisk(price: number, stop: number, totalValueTwd: number, policy: InvestmentPolicy, strategyRisk?: number): number | undefined {
  if (!(price > stop) || totalValueTwd <= 0) return undefined
  const limit = riskLimitOf(strategyRisk ? { riskPerTradePercent: strategyRisk } : undefined, policy).percent
  const budget = (((totalValueTwd * policy.satellitePercent) / 100) * limit) / 100
  return Math.floor(budget / (price - stop))
}

export function planFromStrategy(
  strategy: TradingStrategy,
  market: { close?: number; atr?: number },
  totalValueTwd: number,
  policy: InvestmentPolicy,
): PlanDraft {
  const def = STRATEGY_TEMPLATES[strategy.template]
  const { market: mkt, code } = parseSymbol(strategy.symbols[0] ?? '')
  const params = resolveParams(strategy.template, strategy.params)
  const k = params.atrStop ?? 0
  const close = market.close
  const stop = close && market.atr && k > 0 ? round2(close - k * market.atr) : undefined
  const limit = riskLimitOf(strategy, policy)
  return blank({
    source: 'strategy',
    strategyId: strategy.id,
    ticker: code,
    market: mkt,
    entryMethod: METHOD_OF[strategy.template] ?? 'other',
    setup: `策略卡「${strategy.name}」：${def.label}`,
    trigger: strategy.entryRules || def.entry,
    confirmation: '策略卡狀態為實單；交易部位可以新建倉',
    stopLoss: stop,
    stopMethod: stop ? 'atr' : 'manual',
    entryPrice: close,
    shares: close && stop ? sharesByRisk(close, stop, totalValueTwd, policy, strategy.riskPerTradePercent) : undefined,
    orderType: 'limit',
    orderNote: stop ? `隔日開盤限價買進；成交後設觸價停損 ${fmt(stop)}` : '隔日開盤限價買進；成交後設停損',
    trailing: k > 0 ? 'chandelier' : 'none',
    trailingParam: k > 0 ? k : undefined,
    thesisExit: strategy.exitRules || def.exit,
    rules: [`${limit.source}：每筆停損風險 ${limit.percent}%`, `策略卡出場規則：${strategy.exitRules || def.exit}`],
  })
}

// --- Three-level advice -------------------------------------------------------

export interface AdviceInput {
  ctx: ChecklistContext
  report?: SignalReport | null
  thesis?: StockThesis | null
  today: string
}

export function pendingTradeOf(plan: Pick<PlanDraft, 'ticker' | 'name' | 'market' | 'source' | 'thesisId' | 'strategyId' | 'entryPrice' | 'shares' | 'stopLoss'>): PendingTrade {
  return {
    side: 'buy',
    reason: plan.source === 'strategy' ? 'strategy_entry' : 'tranche_1',
    ticker: plan.ticker,
    name: plan.name,
    sleeve: plan.market === 'US' ? 'satellite_us' : 'satellite_tw',
    currency: plan.market === 'US' ? 'USD' : 'TWD',
    shares: plan.shares ?? 0,
    price: plan.entryPrice ?? 0,
    thesisId: plan.thesisId,
    strategyId: plan.strategyId,
    stopLoss: plan.stopLoss,
    // The bias questions are answered when the trade is recorded.
    biasNotes: '（計畫單階段）',
  }
}

const advice = (level: PlanAdvice['level'], text: string, basis: string): PlanAdvice => ({ level, text, basis })

export function planAdvice(plan: PlanDraft, input: AdviceInput): PlanAdvice[] {
  const out: PlanAdvice[] = []
  const { entryPrice: entry, stopLoss: stop, shares } = plan
  if (!stop) out.push(advice('required', '還沒有設停損', '投資政策：每筆交易都必須設停損'))
  else if (entry && stop >= entry) out.push(advice('required', `停損 ${fmt(stop)} 必須低於進場價 ${fmt(entry)}`, '進出場規則：停損是失效點'))
  if (!entry || !shares) out.push(advice('required', '還沒有填進場價與股數', '計畫單：部位要事先決定'))

  if (entry && shares && stop) {
    const items = buildPreTradeChecklist(pendingTradeOf(plan), input.ctx, {})
    for (const item of items) {
      if (item.manual || item.key === 'bias' || item.passed) continue
      out.push(advice('required', item.label, '交易前檢核'))
    }
  }

  const report = input.report
  if (report && /只買第 1 批/.test(report.headline)) out.push(advice('suggest', '先只買第 1 批，等站回 20 日線再買下一批', `研究卡：${report.headline}`))
  if (report?.suggestedShares && shares && shares > report.suggestedShares) {
    out.push(advice('suggest', `股數 ${fmt(shares)} 超過建議的 ${fmt(report.suggestedShares)} 股`, `研究卡建議股數：${report.sizingNote ?? ''}`))
  }
  const target = plan.targets[0]?.price
  if (entry && stop && target && entry > stop) {
    const rr = (target - entry) / (entry - stop)
    if (rr < 2) out.push(advice('suggest', `風報比只有 ${rr.toFixed(1)}，低於 2`, `第一個停利點 ${fmt(target)}、停損 ${fmt(stop)}`))
  }

  const batch2 = report?.levels.find((l) => l.key === 'batch2')?.price
  if (plan.entryMethod === 'value_batches' && batch2) out.push(advice('notice', `第 1 批常常買太早；第 2 批在 ${fmt(batch2)}`, '進出場規則：分批進場'))
  if (input.thesis && addMonths(input.thesis.updatedAt.slice(0, 10), 4) <= input.today) {
    out.push(advice('notice', '研究卡超過 4 個月沒有更新，先確認論點仍成立', `研究卡更新於 ${input.thesis.updatedAt.slice(0, 10)}`))
  }
  if (plan.stopMethod === 'percent' || plan.stopMethod === 'manual') {
    out.push(advice('notice', '跌停或隔夜跳空時，停損可能無法依價成交；部位要留空間', '台灣市場實務：漲跌幅 10%'))
  }
  return out
}

// --- While the position is open -----------------------------------------------

const lastFinite = (xs: number[]) => {
  for (let i = xs.length - 1; i >= 0; i--) if (Number.isFinite(xs[i])) return xs[i]
  return NaN
}

// The trailing stop the plan's rule gives today, only when it is above the
// stop in force (a stop never moves down).
export function trailingStop(plan: Pick<TradePlan, 'trailing' | 'trailingParam' | 'openedAt' | 'currentStop' | 'stopLoss'>, bars: Bar[]): number | null {
  if (plan.trailing === 'none' || bars.length === 0) return null
  const since = plan.openedAt ? bars.filter((b) => b.date >= plan.openedAt!.slice(0, 10)) : bars
  if (since.length === 0) return null
  let stop = NaN
  if (plan.trailing === 'chandelier') {
    const k = plan.trailingParam ?? 2.5
    stop = Math.max(...since.map((b) => b.high)) - k * lastFinite(atr(bars))
  } else if (plan.trailing === 'moving_average') {
    stop = lastFinite(sma(bars.map((b) => b.close), plan.trailingParam ?? 20))
  } else if (plan.trailing === 'swing_low') {
    stop = Math.min(...bars.slice(-(plan.trailingParam ?? 10)).map((b) => b.low))
  }
  if (!Number.isFinite(stop)) return null
  const current = plan.currentStop ?? plan.stopLoss ?? -Infinity
  return stop > current ? round2(stop) : null
}

export type PositionFlag = 'stop_hit' | 'near_stop' | 'target_hit' | 'time_stop' | 'raise_stop' | 'ok'

export interface PositionStatus {
  close: number
  date: string
  stop: number | null
  rMultiple: number | null
  nextTarget: { price: number; fraction: number } | null
  reachedTarget: { price: number; fraction: number } | null
  daysHeld: number | null
  timeStopLeft: number | null
  raiseTo: number | null
  flags: PositionFlag[]
}

const NEAR_STOP = 0.03

export function positionStatus(plan: TradePlan, bars: Bar[], fallback?: { close: number; date: string }): PositionStatus | null {
  const last = bars[bars.length - 1] ?? (fallback ? { close: fallback.close, date: fallback.date } : null)
  if (!last) return null
  const close = last.close
  const stop = plan.currentStop ?? plan.stopLoss ?? null
  const entry = plan.fillPrice ?? plan.entryPrice
  const risk = entry && plan.stopLoss && entry > plan.stopLoss ? entry - plan.stopLoss : null
  const targets = [...plan.targets].sort((a, b) => a.price - b.price)
  const daysHeld = plan.openedAt ? Math.floor((Date.parse(last.date) - Date.parse(plan.openedAt.slice(0, 10))) / 86400000) : null
  const timeStopLeft = plan.timeStopDays && daysHeld !== null ? plan.timeStopDays - daysHeld : null
  const raiseTo = trailingStop(plan, bars)
  const reachedTarget = targets.filter((t) => close >= t.price).at(-1) ?? null
  const flags: PositionFlag[] = []
  if (stop !== null && close <= stop) flags.push('stop_hit')
  else if (stop !== null && (close - stop) / close < NEAR_STOP) flags.push('near_stop')
  if (reachedTarget) flags.push('target_hit')
  if (timeStopLeft !== null && timeStopLeft <= 0 && entry && close <= entry) flags.push('time_stop')
  if (raiseTo !== null && !flags.includes('stop_hit')) flags.push('raise_stop')
  if (flags.length === 0) flags.push('ok')
  return {
    close,
    date: last.date,
    stop,
    rMultiple: risk && entry ? round2((close - entry) / risk) : null,
    nextTarget: targets.find((t) => t.price > close) ?? null,
    reachedTarget,
    daysHeld,
    timeStopLeft,
    raiseTo,
    flags,
  }
}

// --- The day's work -------------------------------------------------------------

export interface ScanItem {
  priority: number
  level: PlanAdvice['level']
  text: string
  basis: string
  to: string
}

// Discipline order (blueprint 02 §3.1 ①): stops and broken theses come
// before anything that adds risk.
export const SCAN_PRIORITY = {
  stop_hit: 1,
  thesis_exit: 2,
  target_hit: 3,
  time_stop: 4,
  raise_stop: 5,
  buy_zone: 6,
  review_due: 7,
  housekeeping: 8,
} as const

export function scanItem(kind: keyof typeof SCAN_PRIORITY, text: string, basis: string, to: string): ScanItem {
  const priority = SCAN_PRIORITY[kind]
  return { priority, level: priority <= 2 ? 'required' : priority <= 6 ? 'suggest' : 'notice', text, basis, to }
}

export function positionScanItems(plan: TradePlan, status: PositionStatus): ScanItem[] {
  const name = `${plan.ticker} ${plan.name}`.trim()
  const to = `/portfolio/plans?id=${plan.id}`
  const out: ScanItem[] = []
  if (status.flags.includes('stop_hit')) out.push(scanItem('stop_hit', `${name} 收盤 ${fmt(status.close)} 跌破停損 ${fmt(status.stop!)}：依計畫出場`, '出場規則：停損優先', to))
  if (status.flags.includes('target_hit')) {
    const t = status.reachedTarget!
    out.push(scanItem('target_hit', `${name} 到達停利點 ${fmt(t.price)}：出場 ${t.fraction >= 1 ? '全部' : `${Math.round(t.fraction * 100)}%`}`, '計畫單：出場計畫', to))
  }
  if (status.flags.includes('time_stop')) out.push(scanItem('time_stop', `${name} 持有 ${status.daysHeld} 天仍未獲利：時間停損到期`, '計畫單：時間停損', to))
  if (status.flags.includes('raise_stop')) out.push(scanItem('raise_stop', `${name} 停損可上移到 ${fmt(status.raiseTo!)}`, '計畫單：移動停損（只能上移）', to))
  return out
}

export function sortScan(items: ScanItem[]): ScanItem[] {
  return [...items].sort((a, b) => a.priority - b.priority)
}

// --- Execution quality ----------------------------------------------------------

export interface ExecutionStats {
  planned: number
  satelliteBuys: number
  // Mean of (fill − planned) ÷ planned over buys with a plan; + means paid more.
  avgSlippage: number | null
  lateStops: number
}

const SATELLITE_ENTRIES: Trade['reason'][] = ['tranche_1', 'tranche_2', 'tranche_3', 'strategy_entry']

export function slippageOf(trade: Pick<Trade, 'side' | 'price'>, plan: Pick<TradePlan, 'entryPrice'> | undefined): number | null {
  if (!plan?.entryPrice || trade.side !== 'buy') return null
  return (trade.price - plan.entryPrice) / plan.entryPrice
}

export function executionStats(plans: TradePlan[], trades: Trade[]): ExecutionStats {
  const byId = new Map(plans.map((p) => [p.id, p]))
  // Trading-sleeve entries: research-card batches and strategy entries.
  const buys = trades.filter((t) => t.side === 'buy' && SATELLITE_ENTRIES.includes(t.reason))
  const slips = buys.map((t) => slippageOf(t, t.planId ? byId.get(t.planId) : undefined)).filter((s): s is number => s !== null)
  const lateStops = lateStopExits(plans, trades)
  return {
    planned: buys.filter((t) => t.planId).length,
    satelliteBuys: buys.length,
    avgSlippage: slips.length ? slips.reduce((a, b) => a + b, 0) / slips.length : null,
    lateStops,
  }
}
