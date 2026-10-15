import type { MacroCheckIn, MacroSignalKey, Trend } from '../storage/schema'
import { addMonths } from '../calculations/disciplineScore'
import { latestFubon, SERIES_SOURCES, type MacroData, type Point, type SeriesKey } from './macroData'

// Rule-based judgement of the 17 macro signals from public data (handbook
// chapter 05, note on automatic data). Thresholds are deliberately simple
// and live here so the annual review can revise them.
export const RULES = {
  trendMonths: 3,
  ipChangePercent: 0.5,
  unemploymentImprove: -0.1,
  unemploymentWorsen: 0.2,
  payrollStrong: 150,
  payrollWeak: 50,
  businessScorePoints: 2,
  exportYoyPoints: 3,
  usInflationPoints: 0.2,
  twInflationPoints: 0.3,
  policyRatePoints: 0.2,
  curveLoose: 0.5,
  curveTight: 0,
  spreadChangePoints: 0.3,
  balanceSheetPercent: 1,
  dollarPercent: 2,
  valuationBandPercent: 15,
  spreadHot: 3,
  spreadPanic: 6,
  marginPercent: 15,
  vixHot: 13,
  vixPanic: 30,
} as const

export const AUTO_NOTE = '每日自動判斷（公開數據＋富邦報告，免金鑰）'

export interface SignalJudgement {
  value: Trend | -1 | 0 | 1
  reason: string
  // No usable data: left neutral for the user to confirm.
  manual: boolean
}

type Series = Point[] | undefined

function lastPoint(s: Series): Point | undefined {
  return s && s.length > 0 ? s[s.length - 1] : undefined
}

// The latest point dated at least `months` before the last one.
function monthsBefore(s: Series, months: number): Point | undefined {
  const last = lastPoint(s)
  if (!s || !last) return undefined
  const cutoff = addMonths(last.date, -months)
  return [...s].reverse().find((p) => p.date <= cutoff)
}

function average(points: Point[]): number {
  return points.reduce((a, p) => a + p.value, 0) / points.length
}

// Mean of the last n points and of the n before them.
function windows(s: Series, n: number): { recent: number; prior: number; date: string } | undefined {
  if (!s || s.length < n * 2) return undefined
  return { recent: average(s.slice(-n)), prior: average(s.slice(-2 * n, -n)), date: s[s.length - 1].date }
}

// Year-over-year % change at the last point, or `back` points earlier.
function yoy(s: Series, back = 0): { value: number; date: string } | undefined {
  if (!s || s.length < 13 + back) return undefined
  const i = s.length - 1 - back
  return { value: (s[i].value / s[i - 12].value - 1) * 100, date: s[i].date }
}

function sumYoy(s: Series, n: number, back = 0): number | undefined {
  if (!s || s.length < 12 + n + back) return undefined
  const end = s.length - back
  const now = s.slice(end - n, end).reduce((a, p) => a + p.value, 0)
  const before = s.slice(end - n - 12, end - 12).reduce((a, p) => a + p.value, 0)
  return before > 0 ? (now / before - 1) * 100 : undefined
}

const fmt = (v: number, d = 2) => v.toFixed(d)
const signed = (v: number, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`
const src = (key: SeriesKey, date: string) => `（${SERIES_SOURCES[key]}，${date}）`

// Growth and inflation are directions ('flat' when unknown); the other
// pillars are scores (0 when unknown).
function missing(label: string, kind: 'trend' | 'score' = 'score'): SignalJudgement {
  return {
    value: kind === 'trend' ? 'flat' : 0,
    reason: `${label}：今日沒有取得資料，暫列中性，請手動確認`,
    manual: true,
  }
}

function trend(value: Trend, reason: string): SignalJudgement {
  return { value, reason, manual: false }
}

function score(value: -1 | 0 | 1, reason: string): SignalJudgement {
  return { value, reason, manual: false }
}

function byChange(change: number, up: number, down: number): -1 | 0 | 1 {
  if (change >= up) return 1
  if (change <= down) return -1
  return 0
}

const TREND_OF: Record<-1 | 0 | 1, Trend> = { 1: 'up', 0: 'flat', [-1]: 'down' }

export function judgeSignals(data: MacroData): Record<MacroSignalKey, SignalJudgement> {
  const s = data.series
  const m = RULES.trendMonths
  const out = {} as Record<MacroSignalKey, SignalJudgement>

  // --- Growth (direction vs ~3 months ago) ---
  const ip = windows(s.IPMAN, m)
  out['growth.usPmi'] = ip
    ? (() => {
        const pct = (ip.recent / ip.prior - 1) * 100
        return trend(
          TREND_OF[byChange(pct, RULES.ipChangePercent, -RULES.ipChangePercent)],
          `製造業工業生產近 3 個月平均較前 3 個月 ${signed(pct, 1)}%${src('IPMAN', ip.date)}；ISM 指數無免費資料，以此代理`,
        )
      })()
    : missing('製造業工業生產', 'trend')

  const un = windows(s.UNRATE, m)
  const pay = s.PAYEMS && s.PAYEMS.length > m ? s.PAYEMS : undefined
  if (un && pay) {
    const unChange = un.recent - un.prior
    const gain = (pay[pay.length - 1].value - pay[pay.length - 1 - m].value) / m
    const points =
      (unChange <= RULES.unemploymentImprove ? 1 : unChange >= RULES.unemploymentWorsen ? -1 : 0) +
      (gain >= RULES.payrollStrong ? 1 : gain < RULES.payrollWeak ? -1 : 0)
    out['growth.usEmployment'] = trend(
      TREND_OF[Math.sign(points) as -1 | 0 | 1],
      `失業率近 3 個月平均 ${fmt(un.recent, 1)}%（較前 3 個月 ${signed(unChange, 2)}）；非農月均新增 ${Math.round(gain)} 千人${src('UNRATE', un.date)}`,
    )
  } else out['growth.usEmployment'] = missing('美國就業', 'trend')

  const biz = s.TW_BUSINESS_SCORE
  const bizNow = lastPoint(biz)
  const bizBefore = monthsBefore(biz, m)
  out['growth.twBusinessSignal'] =
    bizNow && bizBefore
      ? trend(
          TREND_OF[byChange(bizNow.value - bizBefore.value, RULES.businessScorePoints, -RULES.businessScorePoints)],
          `景氣對策信號 ${bizNow.value} 分（${lightOf(bizNow.value)}），3 個月前 ${bizBefore.value} 分${src('TW_BUSINESS_SCORE', bizNow.date)}`,
        )
      : missing('台灣景氣對策信號', 'trend')

  const exNow = sumYoy(s.TW_EXPORTS, m)
  const exBefore = sumYoy(s.TW_EXPORTS, m, m)
  const exDate = lastPoint(s.TW_EXPORTS)?.date
  out['growth.twExportOrders'] =
    exNow !== undefined && exBefore !== undefined && exDate
      ? trend(
          TREND_OF[byChange(exNow - exBefore, RULES.exportYoyPoints, -RULES.exportYoyPoints)],
          `出口近 3 個月年增 ${fmt(exNow, 1)}%，前一季同期 ${fmt(exBefore, 1)}%${src('TW_EXPORTS', exDate)}`,
        )
      : missing('台灣出口', 'trend')

  // --- Inflation (up = rising) ---
  const cpiNow = yoy(s.CPIAUCSL)
  const cpiBefore = yoy(s.CPIAUCSL, m)
  const pceNow = yoy(s.PCEPILFE)
  const pceBefore = yoy(s.PCEPILFE, m)
  if (cpiNow && cpiBefore && pceNow && pceBefore) {
    const change = (cpiNow.value - cpiBefore.value + (pceNow.value - pceBefore.value)) / 2
    out['inflation.usCpi'] = trend(
      TREND_OF[byChange(change, RULES.usInflationPoints, -RULES.usInflationPoints)],
      `CPI 年增 ${fmt(cpiNow.value, 1)}%（3 個月前 ${fmt(cpiBefore.value, 1)}%）、核心 PCE ${fmt(pceNow.value, 1)}%（${fmt(pceBefore.value, 1)}%）${src('CPIAUCSL', cpiNow.date)}`,
    )
  } else out['inflation.usCpi'] = missing('美國通膨', 'trend')

  const twNow = yoy(s.TW_CPI)
  const twBefore = yoy(s.TW_CPI, m)
  out['inflation.twCpi'] =
    twNow && twBefore
      ? trend(
          TREND_OF[byChange(twNow.value - twBefore.value, RULES.twInflationPoints, -RULES.twInflationPoints)],
          `CPI 年增 ${fmt(twNow.value, 2)}%，3 個月前 ${fmt(twBefore.value, 2)}%${src('TW_CPI', twNow.date)}`,
        )
      : missing('台灣 CPI', 'trend')

  // --- Liquidity (+1 loose, −1 tight) ---
  const ff = lastPoint(s.FEDFUNDS)
  const ffBefore = monthsBefore(s.FEDFUNDS, m)
  out['liquidity.policyRate'] =
    ff && ffBefore
      ? score(
          (-byChange(ff.value - ffBefore.value, RULES.policyRatePoints, -RULES.policyRatePoints) || 0) as -1 | 0 | 1,
          `聯邦基金利率 ${fmt(ff.value)}%，3 個月前 ${fmt(ffBefore.value)}%${src('FEDFUNDS', ff.date)}；台灣央行另參考富邦報告`,
        )
      : missing('政策利率')

  const curve = lastPoint(s.T10Y2Y)
  out['liquidity.yieldCurve'] = curve
    ? score(
        curve.value > RULES.curveLoose ? 1 : curve.value < RULES.curveTight ? -1 : 0,
        `10 年減 2 年利差 ${signed(curve.value)} 個百分點${src('T10Y2Y', curve.date)}`,
      )
    : missing('殖利率曲線')

  const hy = lastPoint(s.BAMLH0A0HYM2)
  const hyBefore = monthsBefore(s.BAMLH0A0HYM2, m)
  out['liquidity.creditSpread'] =
    hy && hyBefore
      ? score(
          (-byChange(hy.value - hyBefore.value, RULES.spreadChangePoints, -RULES.spreadChangePoints) || 0) as -1 | 0 | 1,
          `高收益債利差 ${fmt(hy.value)}%，3 個月前 ${fmt(hyBefore.value)}%${src('BAMLH0A0HYM2', hy.date)}`,
        )
      : missing('信用利差')

  const bs = lastPoint(s.WALCL)
  const bsBefore = monthsBefore(s.WALCL, m)
  out['liquidity.centralBankBalanceSheet'] =
    bs && bsBefore
      ? (() => {
          const pct = (bs.value / bsBefore.value - 1) * 100
          return score(
            byChange(pct, RULES.balanceSheetPercent, -RULES.balanceSheetPercent),
            `Fed 資產負債表 3 個月 ${signed(pct, 1)}%${src('WALCL', bs.date)}`,
          )
        })()
      : missing('央行資產負債表')

  const usd = lastPoint(s.DTWEXBGS)
  const usdBefore = monthsBefore(s.DTWEXBGS, m)
  out['liquidity.usDollar'] =
    usd && usdBefore
      ? (() => {
          const pct = (usd.value / usdBefore.value - 1) * 100
          return score(
            (-byChange(pct, RULES.dollarPercent, -RULES.dollarPercent) || 0) as -1 | 0 | 1,
            `美元指數 3 個月 ${signed(pct, 1)}%（走弱＝寬鬆）${src('DTWEXBGS', usd.date)}`,
          )
        })()
      : missing('美元')

  // --- Sentiment (+1 overheated, −1 panic) ---
  const fubon = latestFubon(data)
  const v = fubon?.valuation
  if (v) {
    const high = v.sdHigh ?? (v.average ? v.average * (1 + RULES.valuationBandPercent / 100) : null)
    const low = v.sdLow ?? (v.average ? v.average * (1 - RULES.valuationBandPercent / 100) : null)
    out['sentiment.valuation'] =
      high !== null && low !== null
        ? score(
            v.pe > high ? 1 : v.pe < low ? -1 : 0,
            `S&P 500 預估本益比 ${v.pe} 倍，近 10 年平均 ${v.average ?? '—'}、一個標準差 ${fmt(low, 1)}～${fmt(high, 1)}（${fubon!.reportTitle}）`,
          )
        : missing('評價')
  } else out['sentiment.valuation'] = missing('評價')

  out['sentiment.credit'] = hy
    ? score(
        hy.value < RULES.spreadHot ? 1 : hy.value > RULES.spreadPanic ? -1 : 0,
        `高收益債利差 ${fmt(hy.value)}%：低於 ${RULES.spreadHot}% 代表信用過度寬鬆、高於 ${RULES.spreadPanic}% 代表恐慌${src('BAMLH0A0HYM2', hy.date)}`,
      )
    : missing('信用條件')

  out['sentiment.ipoHype'] = {
    value: 0,
    reason: '新股上市熱度沒有免費數據，暫列中性；可依新聞與新股掛牌數手動調整',
    manual: true,
  }
  out['sentiment.media'] = {
    value: 0,
    reason: '媒體與周遭氛圍屬質化判斷，暫列中性；若身邊人人談股票可手動調為過熱',
    manual: true,
  }

  const mg = data.margin
  out['sentiment.margin'] = mg
    ? (() => {
        const pct = (mg.now.value / mg.before.value - 1) * 100
        return score(
          byChange(pct, RULES.marginPercent, -RULES.marginPercent),
          `台股融資餘額 ${(Math.round(mg.now.value / 10_000) / 10).toLocaleString('zh-TW')} 億元，較 ${mg.before.date} ${signed(pct, 1)}%（證交所，${mg.now.date}）`,
        )
      })()
    : missing('融資餘額')

  const vix = lastPoint(s.VIXCLS)
  out['sentiment.vix'] = vix
    ? score(
        vix.value < RULES.vixHot ? 1 : vix.value > RULES.vixPanic ? -1 : 0,
        `VIX ${fmt(vix.value)}（低於 ${RULES.vixHot} 過熱、高於 ${RULES.vixPanic} 恐慌）${src('VIXCLS', vix.date)}`,
      )
    : missing('VIX')

  return out
}

// 國發會 light bands for the composite score.
export function lightOf(score: number): string {
  if (score >= 38) return '紅燈'
  if (score >= 32) return '黃紅燈'
  if (score >= 23) return '綠燈'
  if (score >= 17) return '黃藍燈'
  return '藍燈'
}

export type AutoCheckIn = Omit<MacroCheckIn, 'id' | 'createdAt'>

// The month's check-in from the rules: values, a reason per signal, and
// the Fubon summary as the policy note.
export function rulesCheckIn(data: MacroData, today: string): { checkIn: AutoCheckIn; manual: MacroSignalKey[] } {
  const j = judgeSignals(data)
  const t = (k: MacroSignalKey) => j[k].value as Trend
  const n = (k: MacroSignalKey) => j[k].value as number
  const fubon = latestFubon(data)
  return {
    checkIn: {
      date: today,
      growth: {
        usPmi: t('growth.usPmi'),
        usEmployment: t('growth.usEmployment'),
        twBusinessSignal: t('growth.twBusinessSignal'),
        twExportOrders: t('growth.twExportOrders'),
      },
      inflation: { usCpi: t('inflation.usCpi'), twCpi: t('inflation.twCpi') },
      liquidity: {
        policyRate: n('liquidity.policyRate'),
        yieldCurve: n('liquidity.yieldCurve'),
        creditSpread: n('liquidity.creditSpread'),
        centralBankBalanceSheet: n('liquidity.centralBankBalanceSheet'),
        usDollar: n('liquidity.usDollar'),
      },
      sentiment: {
        valuation: n('sentiment.valuation'),
        credit: n('sentiment.credit'),
        ipoHype: n('sentiment.ipoHype'),
        media: n('sentiment.media'),
        margin: n('sentiment.margin'),
        vix: n('sentiment.vix'),
      },
      policyNote: fubon ? `${fubon.reportTitle}：${fubon.summary}` : undefined,
      note: AUTO_NOTE,
      reasons: Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v.reason])),
    },
    manual: (Object.keys(j) as MacroSignalKey[]).filter((k) => j[k].manual),
  }
}

// Whether today's automatic check-in should replace this month's entry:
// never over a manual correction or an AI analysis.
export function shouldAutoSave(existing: MacroCheckIn | undefined, next: AutoCheckIn): boolean {
  if (!existing) return true
  if (existing.note !== AUTO_NOTE) return false
  const strip = (c: AutoCheckIn | MacroCheckIn) =>
    JSON.stringify([c.growth, c.inflation, c.liquidity, c.sentiment, c.reasons, c.policyNote])
  return strip(existing) !== strip(next)
}
