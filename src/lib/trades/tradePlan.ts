import type { InvestmentPolicy, PlanAdvice, StockThesis, Trade, TradePlan, TradingStrategy } from '../storage/schema'
import type { SignalReport } from '../research/signals'
import { VERDICT_LABELS } from '../calculations/thesisScoring'
import { buildPreTradeChecklist, riskLimitOf, type ChecklistContext, type PendingTrade } from '../calculations/preTradeChecklist'
import { addMonths, lateStopExits, plannedPrice } from '../calculations/disciplineScore'
import { SATELLITE_ENTRIES } from '../calculations/tradingPause'
import { atr, sma } from '../backtest/indicators'
import { parseSymbol, resolveParams, STRATEGY_TEMPLATES } from '../backtest/templates'
import type { Bar } from '../market/priceHistory'
import { ADD_ON_LABELS, allows, type RegimeContext } from '../market/regime'
import { EVENT_LABELS, EVENT_RULES, GAP_RISK, upcoming, type MarketEvent } from '../market/events'
import { batchChecks, draftBatches } from './batches'
import { analyzePortfolio } from '../calculations/portfolioRisk'

// The entry-exit assistant's rule layer (handbook 04 §0): drafts a trade
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
  batches: [],
  ...over,
})

export const ENTRY_METHOD_LABELS: Record<TradePlan['entryMethod'], string> = {
  value_batches: '價值區間分批',
  breakout: '突破',
  pullback: '拉回',
  mean_reversion: '均值回歸',
  momentum: '動能輪動',
  event: '事件與財報',
  dca: '定期定額',
  other: '其他',
}
// --- Drafts ------------------------------------------------------------------

// The regime's multiplier on a draft's size, with the rule it rests on.
function applyRegime(draft: PlanDraft, regime: RegimeContext | null | undefined): PlanDraft {
  if (!regime) return draft
  const shares = draft.shares !== undefined ? Math.floor(draft.shares * regime.multiplier) : undefined
  return {
    ...draft,
    shares,
    regimeSnapshot: `${regime.label}（${regime.since} 起）・部位倍數 ${regime.multiplier}`,
    regimeMultiplier: regime.multiplier,
    rules: [...draft.rules, regime.basis],
  }
}

// A blank plan for a trade that starts from neither card.
export function manualPlan(policy: InvestmentPolicy): PlanDraft {
  return blank({ source: 'manual', ticker: '', rules: [`投資政策：每筆停損風險 ${policy.riskPerTradePercent}%（占交易部位）`] })
}

export function planFromThesis(
  thesis: StockThesis,
  report: SignalReport,
  policy: InvestmentPolicy,
  regime?: RegimeContext | null,
  sizing?: { annualVolPercent?: number | null; totalValueTwd: number },
): PlanDraft {
  const draft = thesisDraft(thesis, report, policy)
  // The research card's size, unless target volatility asks for fewer.
  if (sizing && draft.shares && draft.entryPrice) {
    const vol = sizeOptions({ price: draft.entryPrice, totalValueTwd: sizing.totalValueTwd, policy, annualVolPercent: sizing.annualVolPercent }).options.find((o) => o.key === 'volatility')
    if (vol?.shares != null && vol.shares < draft.shares) {
      draft.shares = vol.shares
      draft.rules = [...draft.rules, `部位大小：目標波動度 ${policy.targetVolatilityPercent}% 給 ${vol.shares} 股，少於研究卡建議`]
    }
  }
  const out = applyRegime(draft, regime)
  // The research card's three batches, each the size of the first.
  return { ...out, batches: draftBatches(report.levels, out.shares, new Date().toISOString()) }
}

export const backtestOf = (runs: { strategyId?: string; stats: { full: { winRate: number | null; profitFactor: number | null }; outOfSample: { winRate: number | null; profitFactor: number | null } | null } }[], strategyId?: string) => {
  const run = strategyId ? [...runs].reverse().find((r) => r.strategyId === strategyId) : undefined
  return run ? (run.stats.outOfSample ?? run.stats.full) : null
}

function thesisDraft(thesis: StockThesis, report: SignalReport, policy: InvestmentPolicy): PlanDraft {
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

// --- Position size (handbook 08 §5.3) ---------------------------------------

export interface SizeOption {
  key: 'risk' | 'volatility' | 'kelly'
  label: string
  shares: number | null
  basis: string
}

export interface SizeInput {
  price: number
  stop?: number
  totalValueTwd: number
  policy: InvestmentPolicy
  strategyRisk?: number
  // Annualised volatility of the stock, in %.
  annualVolPercent?: number | null
  // The strategy card's latest backtest.
  backtest?: { winRate: number | null; profitFactor: number | null } | null
  multiplier?: number
}

export interface SizeResult {
  options: SizeOption[]
  chosen: SizeOption['key'] | null
  // The smallest option × the regime multiplier, within the single-position cap.
  shares: number | null
  capShares: number
}

// Fixed risk, target volatility and quarter Kelly side by side; the most
// conservative wins, then the regime multiplier and the single-position cap.
export function sizeOptions(input: SizeInput): SizeResult {
  const { price, stop, totalValueTwd, policy } = input
  const sleeve = (totalValueTwd * policy.satellitePercent) / 100
  const options: SizeOption[] = []
  const risk = stop !== undefined ? sharesByRisk(price, stop, totalValueTwd, policy, input.strategyRisk) : undefined
  options.push({ key: 'risk', label: '固定風險', shares: risk ?? null, basis: risk !== undefined ? `停損虧損 = 交易部位 × 每筆風險` : '沒有停損，無法計算' })

  const vol = input.annualVolPercent
  if (vol && vol > 0 && price > 0) {
    const value = (sleeve * (policy.targetVolatilityPercent / vol)) / policy.maxOpenPositions
    options.push({ key: 'volatility', label: '目標波動度', shares: Math.floor(value / price), basis: `交易部位 ×（目標 ${policy.targetVolatilityPercent}% ÷ 年化波動 ${vol.toFixed(0)}%）÷ ${policy.maxOpenPositions} 檔` })
  } else options.push({ key: 'volatility', label: '目標波動度', shares: null, basis: '沒有價格歷史，無法計算波動' })

  const p = input.backtest?.winRate
  const pf = input.backtest?.profitFactor
  if (p && pf && p > 0 && p < 1 && price > 0) {
    const payoff = (pf * (1 - p)) / p
    const kelly = Math.max(0, p - (1 - p) / payoff)
    options.push({ key: 'kelly', label: '1/4 凱利', shares: Math.floor((sleeve * kelly) / 4 / price), basis: `回測勝率 ${(p * 100).toFixed(0)}%、盈虧比 ${payoff.toFixed(2)}，凱利值 ${(kelly * 100).toFixed(1)}% 取 1/4` })
  } else options.push({ key: 'kelly', label: '1/4 凱利', shares: null, basis: '資料不足：需要策略卡的回測勝率與獲利因子' })

  const capShares = price > 0 ? Math.floor((totalValueTwd * policy.maxSinglePositionPercent) / 100 / price) : 0
  const usable = options.filter((o) => o.shares !== null)
  if (usable.length === 0) return { options, chosen: null, shares: null, capShares }
  const best = usable.reduce((a, b) => (b.shares! < a.shares! ? b : a))
  const shares = Math.min(Math.floor(best.shares! * (input.multiplier ?? 1)), capShares)
  return { options, chosen: best.key, shares, capShares }
}

// The smallest of the three sizing methods before the regime multiplier,
// which applyRegime adds.
function strategyShares(close: number, stop: number, totalValueTwd: number, policy: InvestmentPolicy, strategyRisk: number | undefined, sizing: { annualVolPercent?: number | null; backtest?: SizeInput['backtest'] } | undefined): number | undefined {
  if (!sizing) return sharesByRisk(close, stop, totalValueTwd, policy, strategyRisk)
  return sizeOptions({ price: close, stop, totalValueTwd, policy, strategyRisk, ...sizing }).shares ?? undefined
}

export function planFromStrategy(
  strategy: TradingStrategy,
  market: { close?: number; atr?: number },
  totalValueTwd: number,
  policy: InvestmentPolicy,
  regime?: RegimeContext | null,
  sizing?: { annualVolPercent?: number | null; backtest?: SizeInput['backtest'] },
): PlanDraft {
  const def = STRATEGY_TEMPLATES[strategy.template]
  const { market: mkt, code } = parseSymbol(strategy.symbols[0] ?? '')
  const params = resolveParams(strategy.template, strategy.params)
  // The regime row's stop width replaces the card's when the card has one.
  const k = params.atrStop ? (regime?.row.stopAtr ?? params.atrStop) : 0
  const close = market.close
  const stop = close && market.atr && k > 0 ? round2(close - k * market.atr) : undefined
  const limit = riskLimitOf(strategy, policy)
  return applyRegime(blank({
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
    shares: close && stop ? strategyShares(close, stop, totalValueTwd, policy, strategy.riskPerTradePercent, sizing) : undefined,
    orderType: 'limit',
    orderNote: stop ? `隔日開盤限價買進；成交後設觸價停損 ${fmt(stop)}` : '隔日開盤限價買進；成交後設停損',
    trailing: k > 0 ? 'chandelier' : 'none',
    trailingParam: k > 0 ? k : undefined,
    thesisExit: strategy.exitRules || def.exit,
    rules: [
      `${limit.source}：每筆停損風險 ${limit.percent}%`,
      `策略卡出場規則：${strategy.exitRules || def.exit}`,
      ...(regime && params.atrStop ? [`局勢參數：停損 ${regime.row.stopAtr} × ATR（策略卡 ${params.atrStop}）`] : []),
    ],
  }), regime)
}

// --- Three-level advice -------------------------------------------------------

export interface AdviceInput {
  ctx: ChecklistContext
  report?: SignalReport | null
  thesis?: StockThesis | null
  today: string
  events?: MarketEvent[]
  // Latest close, for the add-on check.
  close?: number | null
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

  const regime = input.ctx.regime
  if (regime) {
    if (regime.multiplier === 0) out.push(advice('required', `${regime.label}：局勢參數暫停新建倉`, regime.basis))
    else if (!allows(regime, plan.entryMethod)) {
      out.push(advice('required', `${regime.label}不允許「${ENTRY_METHOD_LABELS[plan.entryMethod]}」進場`, `局勢參數：允許 ${regime.row.allowedEntries.map((m) => ENTRY_METHOD_LABELS[m]).join('、') || '無'}`))
    }
    const base = input.report?.suggestedShares ?? (plan.regimeMultiplier && plan.shares ? plan.shares / plan.regimeMultiplier : undefined)
    const cap = base !== undefined ? Math.floor(base * regime.multiplier) : undefined
    if (cap !== undefined && shares && regime.multiplier > 0 && shares > cap) {
      out.push(advice('required', `股數 ${fmt(shares)} 超過局勢上限 ${fmt(cap)} 股（建議股數 × ${regime.multiplier}）`, regime.basis))
    }
    if (input.report?.action === 'add' && regime.row.addOn !== 'allowed') {
      out.push(advice('suggest', `${regime.label}的加碼規則是「${ADD_ON_LABELS[regime.row.addOn]}」`, '局勢參數：加碼'))
    }
    if (regime.macroHeadwind) out.push(advice('suggest', '總經逆風：部位可以再小一點，或只買第 1 批', '總經三支柱：逆風'))
    if (regime.coolingOff) out.push(advice('suggest', '局勢參數剛簽署，仍在 7 天冷靜期：照新規則前再確認一次', '紀律：修改規則後的冷靜期'))
    if (regime.changedRecently) out.push(advice('notice', `局勢最近轉為「${regime.label}」（${regime.since} 起）`, '局勢狀態：確認期 3 個交易日'))
  }

  if (plan.batches.length > 1 && plan.status !== 'closed' && plan.status !== 'cancelled') {
    const { policy } = input.ctx
    const total = analyzePortfolio(input.ctx.holdings, input.ctx.theses, policy, input.ctx.guardrails, input.ctx.meta).totalValueTwd
    const strategy = plan.strategyId ? input.ctx.strategies?.find((s) => s.id === plan.strategyId) : undefined
    const limit = riskLimitOf(strategy, policy).percent
    out.push(
      ...batchChecks({
        plan: { ...plan, createdAt: (plan as Partial<TradePlan>).createdAt ?? new Date().toISOString() },
        riskBudgetTwd: (((total * policy.satellitePercent) / 100) * limit) / 100,
        positionCapTwd: (total * policy.maxSinglePositionPercent) / 100,
        addOn: input.ctx.regime?.row.addOn ?? null,
        regimeLabel: input.ctx.regime?.label,
        close: input.close,
        fxUsdTwd: input.ctx.meta.fxUsdTwd,
      }),
    )
  }

  if (input.events && plan.ticker && plan.status === 'draft') {
    const soon = upcoming(input.events, input.today, EVENT_RULES.planSessions, new Set([plan.ticker])).filter((e) => GAP_RISK.includes(e.kind))
    const e = soon[0]
    if (e) {
      const text = e.ticker ? `${e.date} ${EVENT_LABELS[e.kind]}：事件前先別進場，或部位減半` : `${e.date} ${e.title}：公司可能在這之前公布財報，部位可以減半`
      out.push(advice('suggest', text, `事件日曆：${e.title}（${e.source}）；跳空可能越過停損`))
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

// Discipline order (handbook 04 §0): stops and broken theses come
// before anything that adds risk.
export const SCAN_PRIORITY = {
  stop_hit: 1,
  pause: 2,
  thesis_exit: 2,
  regime_exit: 3,
  regime_change: 4,
  target_hit: 5,
  time_stop: 6,
  raise_stop: 7,
  dip_ladder: 8,
  buy_zone: 8,
  entry_signal: 8,
  review_due: 9,
  event: 9,
  housekeeping: 10,
} as const

export function scanItem(kind: keyof typeof SCAN_PRIORITY, text: string, basis: string, to: string, level?: PlanAdvice['level']): ScanItem {
  const priority = SCAN_PRIORITY[kind]
  return { priority, level: level ?? (priority <= 2 ? 'required' : priority <= 8 ? 'suggest' : 'notice'), text, basis, to }
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


export function slippageOf(trade: Pick<Trade, 'side' | 'price'> & Partial<Pick<Trade, 'date'>>, plan: Partial<Pick<TradePlan, 'entryPrice' | 'batches'>> | undefined): number | null {
  if (!plan || trade.side !== 'buy') return null
  const planned = plannedPrice({ date: trade.date ?? '', price: trade.price }, plan)
  return planned ? (trade.price - planned) / planned : null
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
