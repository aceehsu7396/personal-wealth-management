import { rsi, sma } from '../backtest/indicators'
import type { Breadth, FlowDay, IndexKey, IndexPoint, MarginDay } from './indices'

// Rule-based reading of each index (handbook chapter 05 §6): trend state
// from the 60- and 200-day averages, plus flags for drawdown, RSI,
// volatility and the VIX level. No forecasting; every flag names its rule.

export type TrendState = 'bull' | 'weakening' | 'range' | 'strengthening' | 'bear'

export const TREND_LABELS: Record<TrendState, string> = {
  bull: '多頭',
  weakening: '轉弱',
  range: '盤整',
  strengthening: '轉強',
  bear: '空頭',
}

export type Tone = 'good' | 'warn' | 'bad' | 'info'

export const TREND_TONE: Record<TrendState, Tone> = {
  bull: 'good',
  weakening: 'warn',
  range: 'info',
  strengthening: 'warn',
  bear: 'bad',
}

export interface TrendFlag {
  label: string
  rule: string
  tone: Tone
}

export interface IndexTrend {
  date: string
  close: number
  change: number | null
  changePct: number | null
  returns: { w1: number | null; m1: number | null; m3: number | null; ytd: number | null; y1: number | null }
  sma20: number | null
  sma60: number | null
  sma200: number | null
  // Change of the 200-day average over 20 sessions, in %.
  sma200Slope: number | null
  high52: number
  // From the 52-week high, in % (0 at a new high).
  drawdown: number
  rsi14: number | null
  // Annualised 20-day volatility (%) and its rank within the past year.
  vol20: number | null
  volPercentile: number | null
  state: TrendState | null
  stateRule: string
  flags: TrendFlag[]
}

export const TREND_RULES = {
  slopeSessions: 20,
  weakDrawdown: -10,
  correction: -10,
  bearMarket: -20,
  overbought: 70,
  oversold: 30,
  highVolPercentile: 80,
} as const

export const VIX_BANDS = [
  { below: 15, label: '平靜', tone: 'good' as Tone },
  { below: 25, label: '正常', tone: 'info' as Tone },
  { below: 30, label: '警戒', tone: 'warn' as Tone },
  { below: Infinity, label: '恐慌', tone: 'bad' as Tone },
]

export const vixBand = (level: number) => VIX_BANDS.find((b) => level < b.below)!

const SESSIONS = { w1: 5, m1: 21, m3: 63, y1: 252 } as const
const r2 = (v: number) => Math.round(v * 100) / 100
const at = (series: number[], i: number) => (i >= 0 && Number.isFinite(series[i]) ? r2(series[i]) : null)

function stateOf(close: number, s60: number | null, s200: number | null, slope: number | null, drawdown: number): { state: TrendState | null; rule: string } {
  if (s60 === null || s200 === null || slope === null) return { state: null, rule: '資料不足 220 個交易日，無法判斷' }
  const rising = slope > 0
  if (rising && s60 > s200) {
    if (close > s200 && close >= s60 && drawdown > TREND_RULES.weakDrawdown) {
      return { state: 'bull', rule: '收盤在 200 日線之上、200 日線向上、60 日線在 200 日線之上' }
    }
    const why = close < s60 ? '收盤跌破 60 日線' : `距高點回檔超過 ${-TREND_RULES.weakDrawdown}%`
    return { state: 'weakening', rule: `多頭排列中${why}` }
  }
  if (close < s200 && !rising) {
    if (close > s60) return { state: 'strengthening', rule: '空頭排列中收盤站上 60 日線' }
    return { state: 'bear', rule: '收盤在 200 日線之下、200 日線向下' }
  }
  return { state: 'range', rule: '均線方向不一致，沒有明確趨勢' }
}

export function indexTrend(points: IndexPoint[]): IndexTrend | null {
  if (points.length < 2) return null
  const closes = points.map((p) => p.close)
  const i = closes.length - 1
  const close = closes[i]
  const s20 = sma(closes, 20)
  const s60 = sma(closes, 60)
  const s200 = sma(closes, 200)
  const ret = (n: number) => (i - n >= 0 ? r2((close / closes[i - n] - 1) * 100) : null)

  const year = points[i].date.slice(0, 4)
  const lastOfPriorYear = [...points].reverse().find((p) => p.date.slice(0, 4) < year)
  const window = closes.slice(Math.max(0, i - SESSIONS.y1 + 1))
  const high52 = Math.max(...window)
  const drawdown = r2((close / high52 - 1) * 100)

  const slopeBase = at(s200, i - TREND_RULES.slopeSessions)
  const sma200 = at(s200, i)
  const sma200Slope = sma200 !== null && slopeBase !== null ? r2((sma200 / slopeBase - 1) * 100) : null

  // Rolling 20-day volatility from daily log returns.
  const logRet = closes.map((c, k) => (k === 0 ? NaN : Math.log(c / closes[k - 1])))
  const vols: number[] = logRet.map((_, k) => {
    if (k < 20) return NaN
    const slice = logRet.slice(k - 19, k + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1)
    return Math.sqrt(variance * 252) * 100
  })
  const vol20 = at(vols, i)
  const pastVols = vols.slice(Math.max(0, i - SESSIONS.y1 + 1), i + 1).filter(Number.isFinite)
  const volPercentile = vol20 !== null && pastVols.length >= 60 ? Math.round((pastVols.filter((v) => v <= vols[i]).length / pastVols.length) * 100) : null

  const rsi14 = at(rsi(closes, 14), i)
  const { state, rule } = stateOf(close, at(s60, i), sma200, sma200Slope, drawdown)

  const flags: TrendFlag[] = []
  if (drawdown <= TREND_RULES.bearMarket) flags.push({ label: '空頭市場', rule: `距 52 週高點跌逾 ${-TREND_RULES.bearMarket}%`, tone: 'bad' })
  else if (drawdown <= TREND_RULES.correction) flags.push({ label: '修正', rule: `距 52 週高點跌 ${-TREND_RULES.correction}%～${-TREND_RULES.bearMarket}%`, tone: 'warn' })
  if (rsi14 !== null && rsi14 > TREND_RULES.overbought) flags.push({ label: '超買', rule: `RSI(14) 高於 ${TREND_RULES.overbought}`, tone: 'warn' })
  if (rsi14 !== null && rsi14 < TREND_RULES.oversold) flags.push({ label: '超賣', rule: `RSI(14) 低於 ${TREND_RULES.oversold}`, tone: 'warn' })
  if (volPercentile !== null && volPercentile >= TREND_RULES.highVolPercentile) {
    flags.push({ label: '波動偏高', rule: `20 日波動度在過去一年的前 ${100 - TREND_RULES.highVolPercentile}%`, tone: 'warn' })
  }

  return {
    date: points[i].date,
    close,
    change: r2(close - closes[i - 1]),
    changePct: r2((close / closes[i - 1] - 1) * 100),
    returns: {
      w1: ret(SESSIONS.w1),
      m1: ret(SESSIONS.m1),
      m3: ret(SESSIONS.m3),
      ytd: lastOfPriorYear ? r2((close / lastOfPriorYear.close - 1) * 100) : null,
      y1: ret(SESSIONS.y1),
    },
    sma20: at(s20, i),
    sma60: at(s60, i),
    sma200,
    sma200Slope,
    high52,
    drawdown,
    rsi14,
    vol20,
    volPercentile,
    state,
    stateRule: rule,
    flags,
  }
}

// Equal-weight over cap-weight (RSP ÷ SPY) against its 60-day average:
// above means most stocks are taking part, below means a narrow rally.
export function breadthRatio(rsp: IndexPoint[], spy: IndexPoint[]): { date: string; ratio: number; above: boolean } | null {
  const spyByDate = new Map(spy.map((p) => [p.date, p.close]))
  const ratios = rsp.filter((p) => spyByDate.has(p.date)).map((p) => ({ date: p.date, ratio: p.close / spyByDate.get(p.date)! }))
  if (ratios.length < 60) return null
  const avg = sma(ratios.map((r) => r.ratio), 60)
  const last = ratios[ratios.length - 1]
  return { date: last.date, ratio: Math.round(last.ratio * 10_000) / 10_000, above: last.ratio >= avg[avg.length - 1] }
}

export function flowSums(flows: FlowDay[], sessions: number) {
  const recent = flows.slice(-sessions)
  return {
    days: recent.length,
    foreign: recent.reduce((a, f) => a + f.foreign, 0),
    trust: recent.reduce((a, f) => a + f.trust, 0),
    dealer: recent.reduce((a, f) => a + f.dealer, 0),
  }
}

export function marginChange(margin: MarginDay[], sessions = 20): { date: string; balance: number; changePct: number | null } | null {
  const last = margin[margin.length - 1]
  if (!last) return null
  const base = margin[margin.length - 1 - sessions]
  return { date: last.date, balance: last.balance, changePct: base ? r2((last.balance / base.balance - 1) * 100) : null }
}

// --- Summary sentences -----------------------------------------------------

const num = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 })
const signed = (v: number, unit = '%') => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num.format(Math.abs(v))}${unit}`
// NT$ amounts in 億.
const yi = (v: number) => `${num.format(Math.round(Math.abs(v) / 1e8))} 億`
const net = (v: number) => (v >= 0 ? `買超 ${yi(v)}` : `賣超 ${yi(v)}`)

function indexLine(name: string, t: IndexTrend): string {
  const state = t.state ? `${TREND_LABELS[t.state]}（${t.stateRule}）` : t.stateRule
  const change = t.changePct === null ? '' : `（${signed(t.changePct)}）`
  return `${name} ${num.format(t.close)}${change}，${state}，距 52 週高點 ${signed(t.drawdown)}。`
}

const shortLine = (pairs: [string, IndexTrend | null][]) =>
  pairs
    .filter((p): p is [string, IndexTrend] => p[1] !== null)
    .map(([name, t]) => `${name}${t.state ? TREND_LABELS[t.state] : '資料不足'}（${t.changePct === null ? '—' : signed(t.changePct)}）`)
    .join('、')

const CORE_LINE = '核心部位：不因每日走勢調整，照定期定額與再平衡規則。'

function sleeveLine(t: IndexTrend | null): string {
  if (!t || t.sma200 === null) return '交易部位：資料不足，無法判斷是否在 200 日線之上。'
  return t.close < t.sma200
    ? '交易部位：大盤在 200 日線之下，要更謹慎；能不能新建倉、部位多大，依局勢參數表（05 §7）。'
    : '交易部位：大盤在 200 日線之上，照策略卡訊號與局勢參數執行。'
}

export interface MarketInputs {
  trends: Partial<Record<IndexKey, IndexTrend | null>>
  breadth: Breadth | null
  flows: FlowDay[]
  margin: MarginDay[]
  usBreadth: ReturnType<typeof breadthRatio>
}

export function marketSummary(market: 'TW' | 'US', input: MarketInputs): string[] {
  const { trends } = input
  const lines: string[] = []
  if (market === 'TW') {
    if (trends.TAIEX) lines.push(indexLine('加權指數', trends.TAIEX))
    const others = shortLine([['櫃買指數', trends.TPEx ?? null]])
    if (others) lines.push(`${others}。`)
    if (input.breadth) {
      const { up, down } = input.breadth
      lines.push(`上市股票上漲 ${num.format(up)} 家、下跌 ${num.format(down)} 家（${input.breadth.date}）。`)
    }
    if (input.flows.length > 0) {
      const w = flowSums(input.flows, 5)
      const m = flowSums(input.flows, 20)
      lines.push(`外資近 5 日${net(w.foreign)}、近 20 日${net(m.foreign)}；投信近 5 日${net(w.trust)}。`)
    }
    const mc = marginChange(input.margin)
    if (mc) lines.push(`融資餘額 ${yi(mc.balance)}${mc.changePct === null ? '' : `，近 20 日 ${signed(mc.changePct)}`}。`)
    lines.push(CORE_LINE, sleeveLine(trends.TAIEX ?? null))
  } else {
    if (trends.GSPC) lines.push(indexLine('S&P 500', trends.GSPC))
    const others = shortLine([
      ['那斯達克', trends.IXIC ?? null],
      ['道瓊', trends.DJI ?? null],
      ['費城半導體', trends.SOX ?? null],
    ])
    if (others) lines.push(`${others}。`)
    if (trends.VIX) lines.push(`VIX ${num.format(trends.VIX.close)}（${vixBand(trends.VIX.close).label}）。`)
    if (input.usBreadth) {
      lines.push(
        input.usBreadth.above
          ? '等權重（RSP）相對市值加權（SPY）在 60 日均線之上：多數股票一起參與。'
          : '等權重（RSP）相對市值加權（SPY）在 60 日均線之下：漲勢集中在少數權值股。',
      )
    }
    lines.push(CORE_LINE, sleeveLine(trends.GSPC ?? null))
  }
  return lines
}
