import type { AdviceGuardrails, MacroCheckIn, MacroSignalKey, Trend } from '../storage/schema'
import { assessMacro, REGIME_LABELS, STANCE_LABELS, formatTiltRange, type MacroAssessment } from '../calculations/macroRegime'
import { MACRO_SIGNAL_LABELS, monthEndCloses } from '../calculations/fubonTracking'
import { AUTO_NOTE, RULES } from './signalRules'
import { SERIES_SOURCES, type MacroData, type Point, type SeriesKey } from './macroData'

// Month-by-month tracking of the macro review: how the judgement changed,
// which signals moved, and the indicators behind them.

export type SignalValue = Trend | number

export const SIGNAL_KEYS = Object.keys(MACRO_SIGNAL_LABELS) as MacroSignalKey[]

export function signalValue(checkIn: MacroCheckIn, key: MacroSignalKey): SignalValue {
  const [pillar, field] = key.split('.') as ['growth' | 'inflation' | 'liquidity' | 'sentiment', string]
  return (checkIn[pillar] as Record<string, SignalValue>)[field]
}

const TREND_TEXT: Record<Trend, string> = { up: '上升', flat: '持平', down: '下降' }

export function signalText(key: MacroSignalKey, value: SignalValue): string {
  if (typeof value === 'string') return TREND_TEXT[value]
  if (key.startsWith('liquidity.')) return value > 0 ? '寬鬆' : value < 0 ? '緊縮' : '中性'
  return value > 0 ? '過熱' : value < 0 ? '恐慌' : '正常'
}

// −1, 0, +1 for colouring: up/loose/hot = +1.
export function signalSign(value: SignalValue): -1 | 0 | 1 {
  if (typeof value === 'string') return value === 'up' ? 1 : value === 'down' ? -1 : 0
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

export type CheckInSource = 'auto' | 'manual' | 'ai'

export function sourceOf(checkIn: MacroCheckIn): CheckInSource {
  if (checkIn.note === AUTO_NOTE) return 'auto'
  if (checkIn.note?.startsWith('AI')) return 'ai'
  return 'manual'
}

export interface TimelineRow {
  checkIn: MacroCheckIn
  month: string
  assessment: MacroAssessment
  regime: string
  stance: string
  tilt: string
  source: CheckInSource
  // What changed since the previous month (empty for the first month).
  changes: string[]
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${v}`

// One row per month (latest check-in of each month), newest first.
export function judgementTimeline(checkIns: MacroCheckIn[], guardrails: AdviceGuardrails): TimelineRow[] {
  const latestPerMonth = new Map<string, MacroCheckIn>()
  for (const c of [...checkIns].sort((a, b) => a.date.localeCompare(b.date))) latestPerMonth.set(c.date.slice(0, 7), c)
  const ordered = [...latestPerMonth.values()]
  const rows = ordered.map((checkIn, i) => {
    const assessment = assessMacro(checkIn, guardrails)
    const prev = ordered[i - 1]
    const changes: string[] = []
    if (prev) {
      const before = assessMacro(prev, guardrails)
      if (before.regime !== assessment.regime) {
        changes.push(`體制：${REGIME_LABELS[before.regime].split('（')[0]} → ${REGIME_LABELS[assessment.regime].split('（')[0]}`)
      }
      if (before.liquidityScore !== assessment.liquidityScore) {
        changes.push(`流動性 ${signed(before.liquidityScore)} → ${signed(assessment.liquidityScore)}`)
      }
      if (before.sentimentScore !== assessment.sentimentScore) {
        changes.push(`情緒 ${signed(before.sentimentScore)} → ${signed(assessment.sentimentScore)}`)
      }
      if (before.stance !== assessment.stance) {
        changes.push(`判斷：${STANCE_LABELS[before.stance]} → ${STANCE_LABELS[assessment.stance]}`)
      }
      for (const key of SIGNAL_KEYS) {
        const a = signalValue(prev, key)
        const b = signalValue(checkIn, key)
        if (a !== b) changes.push(`${MACRO_SIGNAL_LABELS[key]}：${signalText(key, a)} → ${signalText(key, b)}`)
      }
    }
    return {
      checkIn,
      month: checkIn.date.slice(0, 7),
      assessment,
      regime: REGIME_LABELS[assessment.regime].split('（')[0],
      stance: STANCE_LABELS[assessment.stance],
      tilt: formatTiltRange(assessment.tiltMinPoints, assessment.tiltMaxPoints),
      source: sourceOf(checkIn),
      changes,
    }
  })
  return rows.reverse()
}

export interface MatrixCell {
  value: SignalValue
  metric: number | null
  reason: string | null
  manual: boolean
}

export interface SignalMatrix {
  months: string[]
  rows: { key: MacroSignalKey; cells: (MatrixCell | null)[] }[]
}

// 17 signals × the last `count` months that have a check-in, oldest first.
export function signalMatrix(checkIns: MacroCheckIn[], count = 12): SignalMatrix {
  const latestPerMonth = new Map<string, MacroCheckIn>()
  for (const c of [...checkIns].sort((a, b) => a.date.localeCompare(b.date))) latestPerMonth.set(c.date.slice(0, 7), c)
  const months = [...latestPerMonth.keys()].sort().slice(-count)
  return {
    months,
    rows: SIGNAL_KEYS.map((key) => ({
      key,
      cells: months.map((m) => {
        const c = latestPerMonth.get(m)
        if (!c) return null
        const reason = c.reasons?.[key] ?? null
        return {
          value: signalValue(c, key),
          metric: c.metrics?.[key] ?? null,
          reason,
          manual: reason?.includes('手動') ?? false,
        }
      }),
    })),
  }
}

export interface IndicatorChart {
  id: string
  label: string
  unit: string
  source: string
  points: Point[]
  // Reference lines drawn dashed: the rule thresholds.
  thresholds: { value: number; label: string }[]
}

function yoySeries(points: Point[] | undefined): Point[] {
  if (!points) return []
  const byMonth = new Map(points.map((p) => [p.date.slice(0, 7), p.value]))
  return points
    .map((p) => {
      const [y, m] = p.date.slice(0, 7).split('-')
      const before = byMonth.get(`${Number(y) - 1}-${m}`)
      return before ? { date: p.date, value: Math.round((p.value / before - 1) * 10_000) / 100 } : null
    })
    .filter((p): p is Point => p !== null)
}

function monthly(points: Point[] | undefined): Point[] {
  return points ? monthEndCloses(points) : []
}

const source = (key: SeriesKey) => SERIES_SOURCES[key]

// The indicator charts for the tracking tab, from the daily data snapshot.
export function indicatorSeries(data: MacroData): IndicatorChart[] {
  const s = data.series
  const charts: IndicatorChart[] = [
    { id: 'cpi', label: '美國 CPI 年增率', unit: '%', source: source('CPIAUCSL'), points: yoySeries(s.CPIAUCSL), thresholds: [{ value: 2, label: 'Fed 目標 2%' }] },
    { id: 'pce', label: '美國核心 PCE 年增率', unit: '%', source: source('PCEPILFE'), points: yoySeries(s.PCEPILFE), thresholds: [{ value: 2, label: 'Fed 目標 2%' }] },
    { id: 'unrate', label: '美國失業率', unit: '%', source: source('UNRATE'), points: monthly(s.UNRATE), thresholds: [] },
    { id: 'fedfunds', label: '聯邦基金利率', unit: '%', source: source('FEDFUNDS'), points: monthly(s.FEDFUNDS), thresholds: [] },
    {
      id: 'curve',
      label: '美債 10 年減 2 年利差',
      unit: '個百分點',
      source: source('T10Y2Y'),
      points: monthly(s.T10Y2Y),
      thresholds: [
        { value: RULES.curveTight, label: '倒掛' },
        { value: RULES.curveLoose, label: '寬鬆' },
      ],
    },
    {
      id: 'hy',
      label: '高收益債利差',
      unit: '%',
      source: source('BAMLH0A0HYM2'),
      points: monthly(s.BAMLH0A0HYM2),
      thresholds: [
        { value: RULES.spreadHot, label: '過熱' },
        { value: RULES.spreadPanic, label: '恐慌' },
      ],
    },
    {
      id: 'vix',
      label: 'VIX 恐慌指數',
      unit: '',
      source: source('VIXCLS'),
      points: monthly(s.VIXCLS),
      thresholds: [
        { value: RULES.vixHot, label: '過熱' },
        { value: RULES.vixPanic, label: '恐慌' },
      ],
    },
    { id: 'usd', label: '美元指數（廣義）', unit: '', source: source('DTWEXBGS'), points: monthly(s.DTWEXBGS), thresholds: [] },
    {
      id: 'walcl',
      label: 'Fed 資產負債表',
      unit: '兆美元',
      source: source('WALCL'),
      points: monthly(s.WALCL).map((p) => ({ date: p.date, value: Math.round(p.value / 10_000) / 100 })),
      thresholds: [],
    },
    { id: 'ipman', label: '美國製造業工業生產', unit: '', source: source('IPMAN'), points: monthly(s.IPMAN), thresholds: [] },
    {
      id: 'twbiz',
      label: '台灣景氣對策信號',
      unit: '分',
      source: source('TW_BUSINESS_SCORE'),
      points: monthly(s.TW_BUSINESS_SCORE),
      thresholds: [
        { value: 16.5, label: '藍｜黃藍' },
        { value: 22.5, label: '黃藍｜綠' },
        { value: 31.5, label: '綠｜黃紅' },
        { value: 37.5, label: '黃紅｜紅' },
      ],
    },
    { id: 'twexports', label: '台灣出口年增率', unit: '%', source: source('TW_EXPORTS'), points: yoySeries(s.TW_EXPORTS), thresholds: [{ value: 0, label: '' }] },
    { id: 'twcpi', label: '台灣 CPI 年增率', unit: '%', source: source('TW_CPI'), points: yoySeries(s.TW_CPI), thresholds: [{ value: 2, label: '2%' }] },
  ]
  return charts.filter((c) => c.points.length > 1)
}

// Points within the last `years` years of the series' latest date.
export function lastYears(points: Point[], years: number): Point[] {
  const last = points[points.length - 1]
  if (!last) return []
  const [y, rest] = [Number(last.date.slice(0, 4)), last.date.slice(4)]
  const from = `${y - years}${rest}`
  return points.filter((p) => p.date > from)
}
