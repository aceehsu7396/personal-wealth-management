import type { Holding, InvestmentPolicy, StockThesis } from '../storage/schema'
import type { ThesisEvaluation } from '../calculations/thesisScoring'
import type { MacroAssessment } from '../calculations/macroRegime'
import { STANCE_LABELS } from '../calculations/macroRegime'
import type { TechnicalSnapshot } from './technical'

// Entry and exit advice for a research card (handbook chapter 07 §2.6):
// price levels from the fair values (chapter 08 §2.3 tranches), trend and
// momentum from the daily prices, plus the month's macro stance and the
// position already held. Everything is computed; nothing is typed in.

export type SignalAction = 'buy' | 'add' | 'hold' | 'trim' | 'exit' | 'wait' | 'avoid' | 'review'
export type SignalTone = 'bull' | 'bear' | 'neutral'

export const ACTION_LABELS: Record<SignalAction, string> = {
  buy: '買進',
  add: '加碼',
  hold: '續抱',
  trim: '減碼',
  exit: '出清',
  wait: '等待',
  avoid: '不建議',
  review: '需要複查',
}

// Actions on a held position that ask for attention.
export const EXIT_ALERT_ACTIONS: SignalAction[] = ['trim', 'exit', 'review']

export interface ObservedSignal {
  key: string
  tone: SignalTone
  label: string
  detail: string
}

export interface PriceLevel {
  key: 'batch1' | 'batch2' | 'batch3' | 'trim' | 'exit' | 'stop'
  label: string
  price: number
  // Distance from the current price (%); negative = below it.
  distancePercent: number
}

export interface SignalReport {
  action: SignalAction
  headline: string
  reasons: string[]
  levels: PriceLevel[]
  signals: ObservedSignal[]
  stopLoss: number | null
  // Shares for the next batch (stocks, new or added positions only).
  suggestedShares: number | null
  sizingNote: string | null
  held: boolean
  asOf: string | null
}

export interface HeldPosition {
  shares: number
  avgCost: number
  // Share of the whole portfolio (%).
  weightPercent: number
}

export interface SignalInput {
  thesis: StockThesis
  evaluation: ThesisEvaluation
  macro: MacroAssessment | null
  holding: HeldPosition | null
  totalValueTwd: number
  policy: InvestmentPolicy
}

export const STOP_ATR_MULTIPLE = 2.5
export const EXIT_PREMIUM = 1.2
export const BATCH2_DISCOUNT = 0.9
const TRANCHES = 3

const round2 = (v: number) => Math.round(v * 100) / 100
const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
const gap = (from: number, to: number) => ((to - from) / from) * 100

// The held position for a card: every holding with the same ticker.
export function heldPositionOf(ticker: string, holdings: Holding[], totalValueTwd: number, fxUsdTwd: number): HeldPosition | null {
  const code = ticker.trim().toUpperCase()
  const matches = holdings.filter((h) => h.ticker.trim().toUpperCase().replace(/\.TWO?$/, '') === code && h.shares > 0)
  if (matches.length === 0) return null
  const shares = matches.reduce((a, h) => a + h.shares, 0)
  const cost = matches.reduce((a, h) => a + h.shares * h.avgCost, 0)
  const value = matches.reduce((a, h) => a + h.shares * h.currentPrice * (h.currency === 'USD' ? fxUsdTwd : 1), 0)
  return { shares, avgCost: cost / shares, weightPercent: totalValueTwd > 0 ? (value / totalValueTwd) * 100 : 0 }
}

export function stopLossOf(t: TechnicalSnapshot | null | undefined): number | null {
  if (!t?.atr14) return null
  const stop = t.close - STOP_ATR_MULTIPLE * t.atr14
  return stop > 0 ? round2(stop) : null
}

export function technicalSignals(t: TechnicalSnapshot): ObservedSignal[] {
  const out: ObservedSignal[] = []
  if (t.sma120 !== null) {
    const above = t.close > t.sma120
    const arranged = t.sma20 === null ? '' : t.sma20 > t.sma120 ? '，20 日線在 120 日線之上' : '，20 日線在 120 日線之下'
    out.push({
      key: 'trend',
      tone: above && (t.sma20 ?? t.close) > t.sma120 ? 'bull' : !above && (t.sma20 ?? t.close) < t.sma120 ? 'bear' : 'neutral',
      label: above ? '站上 120 日線（中期趨勢）' : '跌破 120 日線（中期趨勢）',
      detail: `120 日線 ${t.sma120}${arranged}`,
    })
  }
  if (t.cross === 'golden') out.push({ key: 'cross', tone: 'bull', label: '黃金交叉', detail: '近 5 日 20 日線向上穿越 120 日線' })
  if (t.cross === 'death') out.push({ key: 'cross', tone: 'bear', label: '死亡交叉', detail: '近 5 日 20 日線向下穿越 120 日線' })
  if (t.sma200 !== null) {
    const above = t.close > t.sma200
    out.push({
      key: 'longTrend',
      tone: above ? 'bull' : 'bear',
      label: above ? '站上 200 日線（長期多頭）' : '跌破 200 日線（長期轉弱）',
      detail: `200 日線 ${t.sma200}，現價${pct(gap(t.sma200, t.close))}`,
    })
  }
  if (t.high55 !== null && t.close > t.high55) {
    out.push({ key: 'breakout', tone: 'bull', label: '創 55 日新高', detail: `突破前高 ${t.high55}` })
  } else if (t.low20 !== null && t.close < t.low20) {
    out.push({ key: 'breakout', tone: 'bear', label: '跌破 20 日低點', detail: `前低 ${t.low20}，短線仍在破底` })
  }
  if (t.rsi14 !== null) {
    const longUp = t.sma200 !== null && t.close > t.sma200
    if (t.rsi14 < 30) {
      out.push({
        key: 'rsi',
        tone: longUp ? 'bull' : 'neutral',
        label: `RSI ${t.rsi14.toFixed(0)}：超賣`,
        detail: longUp ? '長期多頭中的回檔，常是分批買點' : '長期趨勢偏空，超賣可能持續',
      })
    } else if (t.rsi14 > 70) {
      out.push({ key: 'rsi', tone: 'bear', label: `RSI ${t.rsi14.toFixed(0)}：超買`, detail: '短線漲多，追價風險較高' })
    } else {
      out.push({ key: 'rsi', tone: 'neutral', label: `RSI ${t.rsi14.toFixed(0)}：中性`, detail: '介於 30～70' })
    }
  }
  if (t.ret12m !== null || t.ret6m !== null) {
    const main = t.ret12m ?? t.ret6m!
    const parts = [t.ret6m !== null ? `近 6 個月 ${pct(t.ret6m)}` : null, t.ret12m !== null ? `近 12 個月 ${pct(t.ret12m)}` : null]
    out.push({
      key: 'momentum',
      tone: main > 0 && (t.ret6m ?? 0) >= 0 ? 'bull' : main < 0 && (t.ret6m ?? 0) <= 0 ? 'bear' : 'neutral',
      label: main >= 0 ? '動能向上' : '動能向下',
      detail: parts.filter(Boolean).join('，'),
    })
  }
  return out
}

function macroSignal(macro: MacroAssessment | null): ObservedSignal {
  if (!macro) return { key: 'macro', tone: 'neutral', label: '尚無本月總經判斷', detail: '到市場頁取得富邦總經觀點後會自動帶入' }
  const tone: SignalTone = !macro.satelliteNewPositionsAllowed
    ? 'bear'
    : macro.stance === 'tailwind' || macro.stance === 'strong_tailwind' || macro.stance === 'panic_opportunity'
      ? 'bull'
      : 'neutral'
  return { key: 'macro', tone, label: `總經：${STANCE_LABELS[macro.stance]}`, detail: macro.actionNote }
}

function fundamentalSignals(thesis: StockThesis, evaluation: ThesisEvaluation): ObservedSignal[] {
  const out: ObservedSignal[] = []
  const flags = thesis.auto?.stock?.redFlags ?? []
  if (flags.length > 0) {
    out.push({ key: 'redFlags', tone: 'bear', label: '財報紅旗', detail: flags.map((f) => f.label).join('、') })
  }
  const overall = evaluation.rating?.overall
  if (overall === 'weak') out.push({ key: 'rating', tone: 'bear', label: '觀察評等偏弱', detail: '多數體檢面向未達標' })
  if (overall === 'strong') out.push({ key: 'rating', tone: 'bull', label: '觀察評等體質佳', detail: '多數體檢面向達標' })
  return out
}

// The three buy batches, highest first. Usually buy price → 10% lower →
// bear value, but a wide margin of safety can put the bear value higher.
export function tranchesOf(buyPrice: number, bear: number): { price: number; source: string }[] {
  return [
    { price: buyPrice, source: '買進價' },
    { price: buyPrice * BATCH2_DISCOUNT, source: '買進價再跌 10%' },
    { price: bear, source: '悲觀合理價' },
  ]
    .filter((t) => t.price > 0)
    .sort((a, b) => b.price - a.price)
}

function stockLevels(price: number, evaluation: ThesisEvaluation, thesis: StockThesis, stop: number | null): PriceLevel[] {
  if (evaluation.buyPrice <= 0 || thesis.fairValueBull <= 0) return []
  const keys = ['batch1', 'batch2', 'batch3'] as const
  const raw: Omit<PriceLevel, 'distancePercent'>[] = [
    { key: 'exit', label: '出清（樂觀合理價 +20%）', price: thesis.fairValueBull * EXIT_PREMIUM },
    { key: 'trim', label: '減碼（樂觀合理價）', price: thesis.fairValueBull },
    ...tranchesOf(evaluation.buyPrice, thesis.fairValueBear).map((t, i) => ({ key: keys[i], label: `第 ${i + 1} 批（${t.source}）`, price: t.price })),
  ]
  if (stop !== null) raw.push({ key: 'stop', label: `建議停損（現價 − ${STOP_ATR_MULTIPLE}×ATR）`, price: stop })
  return raw
    .filter((l) => l.price > 0)
    .map((l) => ({ ...l, price: round2(l.price), distancePercent: price > 0 ? Math.round(gap(price, l.price) * 10) / 10 : 0 }))
    .sort((a, b) => b.price - a.price)
}

// Shares for one batch: a third of the target position, but no more than
// the stop allows at the per-trade risk of the trading budget.
export function batchShares(input: {
  price: number
  stop: number | null
  targetPercent: number
  totalValueTwd: number
  policy: InvestmentPolicy
}): { shares: number; note: string } | null {
  const { price, stop, targetPercent, totalValueTwd, policy } = input
  if (price <= 0 || totalValueTwd <= 0 || targetPercent <= 0) return null
  const byTarget = Math.floor((totalValueTwd * targetPercent) / 100 / TRANCHES / price)
  if (stop === null || stop >= price) return { shares: byTarget, note: `目標部位 ${targetPercent}% 的三分之一` }
  const riskBudget = (((totalValueTwd * policy.satellitePercent) / 100) * policy.riskPerTradePercent) / 100
  const byRisk = Math.floor(riskBudget / (price - stop))
  return byRisk < byTarget
    ? { shares: byRisk, note: `受每筆風險 ${policy.riskPerTradePercent}% 限制（停損 ${round2(stop)}）` }
    : { shares: byTarget, note: `目標部位 ${targetPercent}% 的三分之一` }
}

function decideStock(input: SignalInput, price: number, t: TechnicalSnapshot | null) {
  const { thesis, evaluation, macro, holding } = input
  const bull = thesis.fairValueBull
  const tranches = tranchesOf(evaluation.buyPrice, thesis.fairValueBear)
  // First batch (entry) and the last one (strong buy).
  const buy = tranches[0]?.price ?? 0
  const bear = tranches[tranches.length - 1]?.price ?? 0
  const reasons: string[] = []
  const trendDown = !!t && t.sma120 !== null && t.close < t.sma120 && (t.sma20 ?? t.close) < t.sma120
  const breakingDown = !!t && t.low20 !== null && t.close < t.low20
  const macroBlocks = macro !== null && !macro.satelliteNewPositionsAllowed

  if (price <= 0 || buy <= 0 || bull <= 0) {
    return { action: 'wait' as const, headline: '缺少現價或合理價，先完成自動體檢', reasons }
  }

  if (holding) {
    const fromCost = holding.avgCost > 0 ? gap(holding.avgCost, price) : 0
    if (thesis.verdict === 'pass') return { action: 'exit' as const, headline: '你的結論已改為不投資，依計畫出清', reasons }
    if (price >= bull * EXIT_PREMIUM) {
      return { action: 'exit' as const, headline: `現價超過樂觀合理價 20% 以上（出清價 ${round2(bull * EXIT_PREMIUM)}），分批出清`, reasons }
    }
    if (price >= bull) return { action: 'trim' as const, headline: `現價已達樂觀合理價 ${round2(bull)}，減碼約三分之一`, reasons }
    if (fromCost <= -input.policy.reviewDrawdownFromCostPercent) {
      reasons.push(`從成本 ${round2(holding.avgCost)} 下跌 ${Math.abs(fromCost).toFixed(1)}%，超過複查門檻 ${input.policy.reviewDrawdownFromCostPercent}%`)
    }
    if ((thesis.auto?.stock?.redFlags.length ?? 0) > 0) reasons.push('財報出現紅旗')
    if (evaluation.rating?.overall === 'weak') reasons.push('觀察評等轉為偏弱')
    if (t && t.sma200 !== null && t.close < t.sma200 && t.cross === 'death') reasons.push('跌破 200 日線且出現死亡交叉')
    if (reasons.length > 0) return { action: 'review' as const, headline: '持股出現警訊，重新檢查投資理由', reasons }
    if (price <= buy && holding.weightPercent < evaluation.positionCapPercent) {
      if (macroBlocks) return { action: 'hold' as const, headline: '價位可加碼，但總經逆風，暫停加碼', reasons }
      return {
        action: 'add' as const,
        headline: `現價在第 1 批價位 ${round2(buy)} 以下，部位 ${holding.weightPercent.toFixed(1)}% 未達上限 ${evaluation.positionCapPercent}%，可加碼下一批`,
        reasons,
      }
    }
    return {
      action: 'hold' as const,
      headline: `現價在合理區間，續抱；到 ${round2(bull)} 再考慮減碼`,
      reasons: [`成本 ${round2(holding.avgCost)}，目前${pct(fromCost)}`],
    }
  }

  if (thesis.verdict === 'pass') return { action: 'avoid' as const, headline: '你的結論是不投資', reasons }
  if (!thesis.verdict) return { action: 'wait' as const, headline: '先看完體檢並選擇結論', reasons }
  const inBuyZone = price <= buy
  if (thesis.verdict === 'watch') {
    return inBuyZone
      ? { action: 'wait' as const, headline: '已進入買進區；結論改為「值得投資」即可分批進場', reasons }
      : { action: 'wait' as const, headline: `結論為觀察，離第 1 批價位還差 ${Math.abs(gap(price, buy)).toFixed(1)}%`, reasons }
  }
  if (macroBlocks && price <= bull) {
    return { action: 'wait' as const, headline: '總經逆風，交易部位暫停新建倉', reasons: inBuyZone ? ['價位已在買進區，等總經轉為中性以上'] : [] }
  }
  if (price <= bear) {
    return { action: 'buy' as const, headline: `跌破第 3 批價位 ${round2(bear)}，進入強力買進區，可加速完成三批`, reasons }
  }
  if (inBuyZone) {
    if (trendDown && breakingDown) {
      return {
        action: 'buy' as const,
        headline: '進入買進區但仍在破底：只買第 1 批，或等站回 20 日線再買',
        reasons: ['趨勢偏空且跌破 20 日低點'],
      }
    }
    return { action: 'buy' as const, headline: `進入買進區（≤ ${round2(buy)}），買進第 1 批`, reasons }
  }
  if (price <= bull) {
    return { action: 'wait' as const, headline: `等待：離第 1 批價位 ${round2(buy)} 還差 ${Math.abs(gap(price, buy)).toFixed(1)}%`, reasons }
  }
  return { action: 'avoid' as const, headline: `高於樂觀合理價 ${round2(bull)}，價格偏貴`, reasons }
}

function decideEtf(input: SignalInput, t: TechnicalSnapshot | null) {
  const { thesis, holding } = input
  const reasons = ['核心 ETF 照定期定額，不擇時；以下判斷用於交易部位的進出']
  if (thesis.verdict === 'pass') {
    return holding
      ? { action: 'exit' as const, headline: '你的結論已改為不投資，依計畫出清', reasons }
      : { action: 'avoid' as const, headline: '你的結論是不投資', reasons }
  }
  if (!t || t.sma120 === null || t.ret12m === null) {
    return { action: holding ? ('hold' as const) : ('wait' as const), headline: '價格資料不足一年，先照定期定額', reasons }
  }
  const up = t.close > t.sma120 && t.ret12m > 0
  const down = t.close < t.sma120 && t.ret12m < 0
  if (holding) {
    if (down) return { action: 'review' as const, headline: '跌破 120 日線且 12 個月動能為負，檢查是否仍適合持有', reasons }
    return { action: 'hold' as const, headline: up ? '趨勢與動能向上，續抱' : '趨勢不明，續抱並照定期定額', reasons }
  }
  if (!thesis.verdict) return { action: 'wait' as const, headline: '先看完體檢並選擇結論', reasons }
  if (up) return { action: 'buy' as const, headline: '站上 120 日線且 12 個月動能為正，可進場', reasons }
  if (down) return { action: 'wait' as const, headline: '跌破 120 日線且 12 個月動能為負，等趨勢轉強', reasons }
  return { action: 'wait' as const, headline: '趨勢不明，等站穩 120 日線', reasons }
}

export function buildSignals(input: SignalInput): SignalReport {
  const { thesis, evaluation, macro, holding, totalValueTwd, policy } = input
  const t = thesis.auto?.technical ?? null
  const price = thesis.currentPrice > 0 ? thesis.currentPrice : (t?.close ?? 0)
  const stop = stopLossOf(t)
  const isEtf = thesis.kind === 'etf'
  const signals = [...(t ? technicalSignals(t) : []), macroSignal(macro), ...fundamentalSignals(thesis, evaluation)]
  const decision = isEtf ? decideEtf(input, t) : decideStock(input, price, t)

  let sizing: { shares: number; note: string } | null = null
  if (!isEtf && (decision.action === 'buy' || decision.action === 'add')) {
    const remaining = holding ? evaluation.positionCapPercent - holding.weightPercent : evaluation.targetPositionPercent
    sizing = batchShares({ price, stop, targetPercent: Math.max(Math.min(evaluation.targetPositionPercent, remaining), 0), totalValueTwd, policy })
  }

  return {
    action: decision.action,
    headline: decision.headline,
    reasons: decision.reasons,
    levels: isEtf ? (stop !== null ? [{ key: 'stop', label: `參考停損（現價 − ${STOP_ATR_MULTIPLE}×ATR）`, price: stop, distancePercent: Math.round(gap(price, stop) * 10) / 10 }] : []) : stockLevels(price, evaluation, thesis, stop),
    signals,
    stopLoss: stop,
    suggestedShares: sizing?.shares ?? null,
    sizingNote: sizing?.note ?? null,
    held: holding !== null,
    asOf: t?.date ?? null,
  }
}
