import { rsi, sma } from '../backtest/indicators'
import type { MacroAssessment } from '../calculations/macroRegime'
import type { EntryMethod, RegimeKey, RegimeParamRow, RegimeParams } from '../storage/schema'
import type { Breadth, FlowDay, IndexPoint, MarginDay } from './indices'
import { flowSums, marginChange, vixBand, type IndexTrend, type Tone } from './trend'
import type { MacroData, Point } from '../macro/macroData'
import type { ValuationPoint } from './valuation'

// Market regime (handbook 05 §7, 04 §0.1): one of seven states, read from
// the TAIEX by fixed price rules and confirmed over a few sessions. The
// regime picks a row of the signed parameter table, which sets the size
// multiplier, allowed entries, stop width and add-on rule for new plans.
// Facet scores and the macro pillars are shown as basis; the macro read can
// only make the result more conservative.

export const REGIME_LABELS: Record<RegimeKey, string> = {
  bull: '多頭延續',
  overheated: '多頭過熱',
  correction: '修正',
  bear: '空頭',
  crash: '崩跌與流動性危機',
  rebound: '反彈初期',
  range: '盤整',
}

export const REGIME_TONE: Record<RegimeKey, Tone> = {
  bull: 'good',
  overheated: 'warn',
  correction: 'warn',
  bear: 'bad',
  crash: 'bad',
  rebound: 'info',
  range: 'info',
}

// Table order of handbook 05 §7.
export const REGIME_ORDER: RegimeKey[] = ['bull', 'overheated', 'correction', 'bear', 'crash', 'rebound', 'range']

export const REGIME_RULES = {
  crashDrop20: -15,
  crashDrawdown: -15,
  crashVix: 35,
  crashVolPercentile: 95,
  bearDrawdown: -20,
  correction: -10,
  reboundTrough: -15,
  reboundLookback: 60,
  overheatRsi: 70,
  overheatYear: 30,
  confirmSessions: 3,
  recentSessions: 5,
} as const

const R = REGIME_RULES

// One rule per regime, checked in this order; the first that holds wins.
export const REGIME_RULE_TEXT: Record<RegimeKey, string> = {
  crash: `20 個交易日跌超過 ${-R.crashDrop20}%；或回撤超過 ${-R.crashDrawdown}%，且 VIX ≥ ${R.crashVix} 或波動在一年的前 ${100 - R.crashVolPercentile}%`,
  bear: `距 52 週高點回撤 ${-R.bearDrawdown}% 以上；或收盤在 200 日線與 60 日線之下，且 200 日線往下`,
  correction: `距 52 週高點回撤 ${-R.correction}% 到 ${-R.bearDrawdown}%`,
  rebound: `過去 ${R.reboundLookback} 個交易日曾回撤 ${-R.reboundTrough}% 以上，現在收盤站上 60 日線、回撤小於 ${-R.correction}%`,
  overheated: `收盤在 200 日線之上，且 RSI(14) ≥ ${R.overheatRsi} 或一年漲幅 ≥ ${R.overheatYear}%`,
  bull: '收盤在 200 日線之上，200 日線往上，回撤小於 10%',
  range: '以上都不符合：均線方向不一致，沒有明確趨勢',
}
const RULE_ORDER: RegimeKey[] = ['crash', 'bear', 'correction', 'rebound', 'overheated', 'bull', 'range']
export const REGIME_RULE_LIST = RULE_ORDER.map((key) => ({ key, label: REGIME_LABELS[key], rule: REGIME_RULE_TEXT[key] }))

export interface DayMetrics {
  close: number
  sma60: number
  sma200: number
  // 200-day average change over 20 sessions, in %.
  slope200: number
  // From the 252-session high, in %.
  drawdown: number
  // Lowest drawdown of the last reboundLookback sessions.
  trough: number
  ret20: number
  ret252: number
  rsi14: number
  volPercentile: number
  vix: number | null
}

const pct = (a: number, b: number) => (a / b - 1) * 100

// Daily inputs for every session; NaN until there is enough history.
export function dailyMetrics(points: IndexPoint[], vix: IndexPoint[] = []): DayMetrics[] {
  const closes = points.map((p) => p.close)
  const s60 = sma(closes, 60)
  const s200 = sma(closes, 200)
  const r14 = rsi(closes, 14)
  const vixBy = new Map(vix.map((p) => [p.date, p.close]))
  let lastVix: number | null = null
  const vols = closes.map((_, k) => {
    if (k < 21) return NaN
    const rets = closes.slice(k - 20, k + 1).map((c, j, a) => (j === 0 ? 0 : Math.log(c / a[j - 1]))).slice(1)
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length
    return Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1))
  })
  const draw: number[] = []
  return points.map((p, i) => {
    const high = Math.max(...closes.slice(Math.max(0, i - 251), i + 1))
    draw.push(pct(closes[i], high))
    const pastVols = vols.slice(Math.max(0, i - 251), i + 1).filter(Number.isFinite)
    if (vixBy.has(p.date)) lastVix = vixBy.get(p.date)!
    return {
      close: closes[i],
      sma60: s60[i],
      sma200: s200[i],
      slope200: i >= 20 ? pct(s200[i], s200[i - 20]) : NaN,
      drawdown: draw[i],
      trough: Math.min(...draw.slice(Math.max(0, i - R.reboundLookback + 1))),
      ret20: i >= 20 ? pct(closes[i], closes[i - 20]) : NaN,
      ret252: i >= 252 ? pct(closes[i], closes[i - 252]) : NaN,
      rsi14: r14[i],
      volPercentile: Number.isFinite(vols[i]) && pastVols.length >= 60 ? (pastVols.filter((v) => v <= vols[i]).length / pastVols.length) * 100 : NaN,
      vix: lastVix,
    }
  })
}

// The raw regime of one session, before confirmation; null without 200 days.
export function classifyDay(m: DayMetrics): RegimeKey | null {
  if (!Number.isFinite(m.sma200) || !Number.isFinite(m.slope200)) return null
  const stressed = (m.vix !== null && m.vix >= R.crashVix) || m.volPercentile >= R.crashVolPercentile
  if (m.ret20 <= R.crashDrop20 || (m.drawdown <= R.crashDrawdown && stressed)) return 'crash'
  if (m.drawdown <= R.bearDrawdown || (m.close < m.sma200 && m.close < m.sma60 && m.slope200 < 0)) return 'bear'
  if (m.drawdown <= R.correction) return 'correction'
  if (m.trough <= R.reboundTrough && m.close > m.sma60) return 'rebound'
  if (m.close > m.sma200 && (m.rsi14 >= R.overheatRsi || m.ret252 >= R.overheatYear)) return 'overheated'
  if (m.close > m.sma200 && m.slope200 > 0) return 'bull'
  return 'range'
}

export interface RegimeSegment {
  regime: RegimeKey
  // First session of the run that was later confirmed.
  start: string
  confirmedOn: string
  end: string
  startClose: number
  // TAIEX change after the start, in %; null when not yet known.
  after: { m1: number | null; m3: number | null; m6: number | null }
}

const AFTER = { m1: 21, m3: 63, m6: 126 } as const

export interface RegimeHistory {
  segments: RegimeSegment[]
  // Unconfirmed read and date of every session.
  raw: (RegimeKey | null)[]
  dates: string[]
}

// Every session re-read with the confirmation rule: a new regime needs
// confirmSessions in a row, except a crash, which counts the same day.
export function regimeHistory(points: IndexPoint[], vix: IndexPoint[] = []): RegimeHistory {
  const raw = dailyMetrics(points, vix).map(classifyDay)
  const segments: RegimeSegment[] = []
  let candidate: RegimeKey | null = null
  let runStart = -1
  const open = (regime: RegimeKey, startIdx: number, confirmIdx: number) => {
    const prev = segments[segments.length - 1]
    if (prev) prev.end = points[startIdx - 1]?.date ?? prev.end
    const after = (n: number) => (points[startIdx + n] ? Math.round(pct(points[startIdx + n].close, points[startIdx].close) * 100) / 100 : null)
    segments.push({
      regime,
      start: points[startIdx].date,
      confirmedOn: points[confirmIdx].date,
      end: points[points.length - 1].date,
      startClose: points[startIdx].close,
      after: { m1: after(AFTER.m1), m3: after(AFTER.m3), m6: after(AFTER.m6) },
    })
  }
  raw.forEach((r, i) => {
    if (r === null) return
    const current = segments[segments.length - 1]?.regime
    if (current === undefined) return open(r, i, i)
    if (r === current) {
      candidate = null
      return
    }
    if (r !== candidate) {
      candidate = r
      runStart = i
    }
    if (r === 'crash' || i - runStart + 1 >= R.confirmSessions) {
      open(r, runStart, i)
      candidate = null
    }
  })
  return { segments, raw, dates: points.map((p) => p.date) }
}

// --- Facet scores (basis only) ------------------------------------------------

export interface Facet {
  key: string
  label: string
  score: number | null
  basis: string
}

const clamp = (v: number) => Math.max(-2, Math.min(2, v))
const yi = (v: number) => `${Math.round(v / 1e8).toLocaleString('zh-TW')} 億`

export interface FacetInputs {
  taiex: IndexTrend | null
  vix: IndexTrend | null
  breadth: Breadth | null
  usBreadth: { above: boolean } | null
  flows: FlowDay[]
  margin: MarginDay[]
  macro: MacroAssessment | null
  // Stage 5: FRED and ETF series, and the TWSE-wide P/E history.
  macroData?: MacroData | null
  valuation?: ValuationPoint[]
}

export const FACET_RULES = {
  creditDrop: -1,
  creditStress: -3,
  dollarPercent: 2,
  valuationHigh: 80,
  valuationExtreme: 95,
  valuationLow: 20,
  valuationCheap: 5,
  valuationMinDays: 240,
} as const

const shiftMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}
// The change in % over the last three months, with the last point.
function threeMonth(points: Point[] | undefined): { pct: number; last: Point } | null {
  const last = points?.at(-1)
  if (!points || !last) return null
  const before = [...points].reverse().find((p) => p.date <= shiftMonths(last.date, -3))
  return before && before.value !== 0 ? { pct: (last.value / before.value - 1) * 100, last } : null
}
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

export function creditFacet(d: MacroData | null | undefined): Facet {
  const c = threeMonth(d?.series.HYG_IEF)
  if (!c) return { key: 'credit', label: '信用', score: null, basis: '資料不足' }
  const score = c.pct <= FACET_RULES.creditStress ? -2 : c.pct <= FACET_RULES.creditDrop ? -1 : c.pct > 0 ? 1 : 0
  return { key: 'credit', label: '信用', score, basis: `高收益債 ÷ 公債 ETF（HYG ÷ IEF）3 個月 ${signedPct(c.pct)}（${c.last.date}，Yahoo Finance）` }
}

export function ratesFacet(d: MacroData | null | undefined): Facet {
  const curve = d?.series.T10Y2Y
  const last = curve?.at(-1)
  if (!curve || !last) return { key: 'rates', label: '利率', score: null, basis: '資料不足' }
  const year = curve.filter((p) => p.date > shiftMonths(last.date, -12))
  const wasInverted = year.some((p) => p.value < 0)
  const fed = threeMonth(d?.series.FEDFUNDS)
  const cutting = !!fed && fed.last.value < fed.last.value / (1 + fed.pct / 100) - 0.1
  let score = 0
  let why = '利差為正、利率沒有明顯變化'
  if (last.value > 0 && wasInverted) {
    score = -1
    why = '一年內曾倒掛、現在轉正：歷史上常在衰退前出現'
  } else if (last.value > 0 && cutting) {
    score = 1
    why = '利差為正且聯準會在降息'
  } else if (last.value < 0) {
    why = '殖利率曲線倒掛中'
  }
  return { key: 'rates', label: '利率', score, basis: `10 年減 2 年利差 ${last.value.toFixed(2)} 個百分點（${last.date}）：${why}（資料：FRED）` }
}

export function valuationFacet(points: ValuationPoint[] | undefined): Facet {
  const last = points?.at(-1)
  if (!points || !last) return { key: 'valuation', label: '估值', score: null, basis: '資料不足' }
  if (points.length < FACET_RULES.valuationMinDays) {
    return { key: 'valuation', label: '估值', score: null, basis: `台股整體本益比 ${last.pe} 倍（${last.date}，證交所）；歷史不足一年，不計分` }
  }
  const rank = Math.round((points.filter((p) => p.pe <= last.pe).length / points.length) * 100)
  const r = FACET_RULES
  const score = rank >= r.valuationExtreme ? -2 : rank >= r.valuationHigh ? -1 : rank <= r.valuationCheap ? 2 : rank <= r.valuationLow ? 1 : 0
  return { key: 'valuation', label: '估值', score, basis: `台股整體本益比 ${last.pe} 倍，在紀錄中的第 ${rank} 百分位（證交所）` }
}

export function fxFacet(d: MacroData | null | undefined): Facet {
  const dollar = threeMonth(d?.series.DTWEXBGS)
  const twd = threeMonth(d?.indexCloses?.usdtwd)
  if (!dollar && !twd) return { key: 'fx', label: '匯率', score: null, basis: '資料不足' }
  const limit = FACET_RULES.dollarPercent
  const weaker = (dollar ? dollar.pct <= -limit : true) && (twd ? twd.pct <= -limit : true)
  const stronger = (dollar?.pct ?? 0) >= limit || (twd?.pct ?? 0) >= limit
  const parts = [dollar && `美元指數 3 個月 ${signedPct(dollar.pct)}`, twd && `美元兌新台幣 ${signedPct(twd.pct)}`].filter(Boolean).join('、')
  return { key: 'fx', label: '匯率', score: weaker ? 1 : stronger ? -1 : 0, basis: `${parts}（FRED）：美元走弱、新台幣走強有利資金流入台股` }
}

const TREND_SCORE = { bull: 2, strengthening: 1, range: 0, weakening: -1, bear: -2 } as const
const STANCE_SCORE = { strong_tailwind: 2, tailwind: 1, neutral: 0, panic_opportunity: 0, headwind: -1, strong_headwind: -2 } as const

export function facetScores(input: FacetInputs): Facet[] {
  const out: Facet[] = []
  const t = input.taiex
  out.push(
    t?.state
      ? { key: 'trend', label: '趨勢', score: TREND_SCORE[t.state], basis: `加權指數：${t.stateRule}` }
      : { key: 'trend', label: '趨勢', score: null, basis: '資料不足' },
  )

  const b = input.breadth
  if (b && b.up + b.down > 0) {
    const share = b.up / (b.up + b.down)
    let score = share >= 0.65 ? 2 : share >= 0.55 ? 1 : share <= 0.35 ? -2 : share <= 0.45 ? -1 : 0
    if (input.usBreadth) score += input.usBreadth.above ? 1 : -1
    out.push({
      key: 'breadth',
      label: '廣度',
      score: clamp(score),
      basis: `上市上漲 ${b.up} 家、下跌 ${b.down} 家（${b.date}）${input.usBreadth ? `；美股等權重 ${input.usBreadth.above ? '強於' : '弱於'}市值加權` : ''}`,
    })
  } else out.push({ key: 'breadth', label: '廣度', score: null, basis: '資料不足' })

  const v = input.vix
  if (v) {
    const band = vixBand(v.close)
    let score = v.close < 15 ? 1 : v.close < 25 ? 0 : v.close < 30 ? -1 : -2
    if (t?.volPercentile != null && t.volPercentile >= 80) score -= 1
    out.push({ key: 'volatility', label: '波動', score: clamp(score), basis: `VIX ${v.close.toFixed(1)}（${band.label}）${t?.volPercentile != null ? `；加權指數波動在一年的第 ${t.volPercentile} 百分位` : ''}` })
  } else out.push({ key: 'volatility', label: '波動', score: null, basis: '資料不足' })

  const mc = marginChange(input.margin)
  if (mc?.changePct != null) {
    const score = mc.changePct >= 10 ? -1 : mc.changePct <= -10 ? 1 : 0
    out.push({ key: 'leverage', label: '情緒與部位', score, basis: `融資餘額近 20 日 ${mc.changePct > 0 ? '+' : ''}${mc.changePct}%（增加超過 10% 視為過熱，減少超過 10% 視為去槓桿）` })
  } else out.push({ key: 'leverage', label: '情緒與部位', score: null, basis: '資料不足' })

  if (input.flows.length >= 20) {
    const f = flowSums(input.flows, 20).foreign
    const score = f >= 1500e8 ? 2 : f > 0 ? 1 : f <= -1500e8 ? -2 : -1
    out.push({ key: 'flows', label: '資金', score, basis: `外資近 20 日${f >= 0 ? '買超' : '賣超'} ${yi(Math.abs(f))}（超過 1,500 億為 ±2）` })
  } else out.push({ key: 'flows', label: '資金', score: null, basis: '資料不足' })

  out.push(creditFacet(input.macroData), ratesFacet(input.macroData), valuationFacet(input.valuation), fxFacet(input.macroData))

  const m = input.macro
  out.push(
    m
      ? { key: 'macro', label: '總經三支柱', score: STANCE_SCORE[m.stance], basis: m.actionNote }
      : { key: 'macro', label: '總經三支柱', score: null, basis: '還沒有總經月檢視' },
  )
  return out
}

// --- Regime context for plans and checks ----------------------------------------

export interface RegimeContext {
  regime: RegimeKey
  label: string
  since: string
  // Raw read differs from the confirmed one: the regime may be changing.
  pending: RegimeKey | null
  changedRecently: boolean
  row: RegimeParamRow
  // Row multiplier, halved under a strong macro headwind.
  multiplier: number
  macroHalved: boolean
  macroHeadwind: boolean
  // Signed within the cooling-off days (handbook 02 §9.1).
  coolingOff: boolean
  basis: string
}

export const COOLING_OFF_DAYS = 7

export function rowOf(params: RegimeParams, regime: RegimeKey): RegimeParamRow {
  return params.rows.find((r) => r.regime === regime) ?? params.rows[params.rows.length - 1]
}

export function regimeContext(
  history: RegimeHistory,
  params: RegimeParams,
  macro: MacroAssessment | null,
  today: string,
): RegimeContext | null {
  const seg = history.segments[history.segments.length - 1]
  if (!seg) return null
  const row = rowOf(params, seg.regime)
  const macroHalved = macro?.stance === 'strong_headwind'
  const multiplier = macroHalved ? row.sizeMultiplier / 2 : row.sizeMultiplier
  const last = history.raw[history.raw.length - 1]
  const recentFrom = history.dates[Math.max(0, history.dates.length - R.recentSessions)]
  const signed = params.signedAt?.slice(0, 10)
  const coolingOff = !!signed && (Date.parse(today) - Date.parse(signed)) / 86400000 < COOLING_OFF_DAYS
  return {
    regime: seg.regime,
    label: REGIME_LABELS[seg.regime],
    since: seg.start,
    pending: last && last !== seg.regime ? last : null,
    changedRecently: history.segments.length > 1 && seg.confirmedOn >= recentFrom,
    row,
    multiplier,
    macroHalved,
    macroHeadwind: macro?.stance === 'headwind',
    coolingOff,
    basis: `局勢參數：${REGIME_LABELS[seg.regime]}（${seg.start} 起），部位倍數 ${multiplier}${macroHalved ? '（總經強烈逆風，減半）' : ''}`,
  }
}

export const allows = (ctx: RegimeContext, method: EntryMethod) => ctx.multiplier > 0 && ctx.row.allowedEntries.includes(method)

export const ADD_ON_LABELS = { allowed: '可加碼', scheduled: '只有事先寫好的批次', none: '不加碼' } as const
