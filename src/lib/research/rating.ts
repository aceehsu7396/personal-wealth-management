import type { InvestmentPolicy } from '../storage/schema'
import { autoFairValues, type AutoResearch } from './autoResearch'

// The research card's watch rating, from the automatic health check only
// (handbook chapter 07 §1.4): each dimension is good / neutral / warn with
// a reason, then an overall rating.

export type Tone = 'good' | 'neutral' | 'warn'

export interface RatingDimension {
  key: string
  label: string
  tone: Tone
  reason: string
}

export type OverallRating = 'strong' | 'caution' | 'weak'

export interface AutoRating {
  dimensions: RatingDimension[]
  overall: OverallRating
  goodCount: number
  warnCount: number
}

export const OVERALL_LABELS: Record<OverallRating, string> = { strong: '體質佳', caution: '留意', weak: '偏弱' }

export const RATING_RULES = {
  fScoreGood: 6,
  fScoreWarn: 5,
  roeGood: 10,
  roeWarn: 8,
  growthGood: 10,
  debtMax: 60,
  dividendYears: 5,
  etfExcessFloor: -3,
  etfTradeValue: 0.5,
  etfDividendYears: 3,
} as const

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(d)}%`)

function overallOf(dimensions: RatingDimension[]): Pick<AutoRating, 'overall' | 'goodCount' | 'warnCount'> {
  const goodCount = dimensions.filter((d) => d.tone === 'good').length
  const warnCount = dimensions.filter((d) => d.tone === 'warn').length
  return { overall: warnCount === 0 ? 'strong' : warnCount <= 2 ? 'caution' : 'weak', goodCount, warnCount }
}

export function rateAuto(auto: AutoResearch, policy: InvestmentPolicy, price?: number): AutoRating | null {
  if (auto.kind === 'etf') {
    const e = auto.etf
    if (!e) return null
    const excess = e.vs0050?.excess3y ?? null
    const dimensions: RatingDimension[] = [
      {
        key: 'return',
        label: '報酬',
        tone: excess === null ? (e.returns.y3 !== null && e.returns.y3 > 0 ? 'good' : 'neutral') : excess >= 0 ? 'good' : excess >= RATING_RULES.etfExcessFloor ? 'neutral' : 'warn',
        reason: excess === null ? `近 3 年年化 ${pct(e.returns.y3)}` : `近 3 年年化 ${pct(e.returns.y3)}，與 0050 差 ${excess > 0 ? '+' : ''}${excess.toFixed(1)} 個百分點`,
      },
      {
        key: 'risk',
        label: '風險',
        tone: e.maxDrawdown === null ? 'neutral' : -e.maxDrawdown <= policy.maxDrawdownTolerancePercent ? 'good' : 'warn',
        reason: `最大回撤 ${pct(e.maxDrawdown)}（投資政策上限 −${policy.maxDrawdownTolerancePercent}%）`,
      },
      {
        key: 'liquidity',
        label: '流動性',
        tone: e.avgTradeValue === null ? 'neutral' : e.avgTradeValue >= RATING_RULES.etfTradeValue ? 'good' : 'warn',
        reason: `日均成交 ${e.avgTradeValue?.toFixed(2) ?? '—'} 億`,
      },
      {
        key: 'dividend',
        label: '配息',
        tone: e.distributionYears >= RATING_RULES.etfDividendYears ? 'good' : 'neutral',
        reason: `連續配息 ${e.distributionYears} 年、殖利率 ${pct(e.yieldTtm, 2)}`,
      },
    ]
    return { dimensions, ...overallOf(dimensions) }
  }

  const s = auto.stock
  if (!s) return null
  const f = s.fScore?.score ?? null
  const roe = s.roe
  const qualityGood = (s.isFinancial || (f !== null && f >= RATING_RULES.fScoreGood)) && roe !== null && roe >= RATING_RULES.roeGood
  const qualityWarn = (!s.isFinancial && f !== null && f < RATING_RULES.fScoreWarn) || (roe !== null && roe < RATING_RULES.roeWarn)

  const growthGood = (s.epsCagr3y ?? -1) >= RATING_RULES.growthGood && (s.revenueYoyTtm ?? -1) >= 0
  const growthWarn = (s.epsCagr3y !== null && s.epsCagr3y < 0) || (s.revenueYoyTtm !== null && s.revenueYoyTtm < 0)

  const negativeFcf = s.freeCashFlow.filter((x) => x.value < 0).length
  const safetyOk =
    (s.isFinancial || s.debtRatio === null || s.debtRatio <= RATING_RULES.debtMax) &&
    (s.currentRatio === null || s.currentRatio >= 1) &&
    (s.isFinancial || negativeFcf < 2)

  const fair = autoFairValues(auto, undefined, price)
  const p = price ?? auto.price
  const valuationTone: Tone = !fair || !p ? 'neutral' : p <= fair.base ? 'good' : p > fair.bull ? 'warn' : 'neutral'

  const payout = s.dividends.payoutRatio
  const dividendTone: Tone =
    payout !== null && payout > 100 ? 'warn' : s.dividends.consecutiveYears >= RATING_RULES.dividendYears ? 'good' : 'neutral'

  const dimensions: RatingDimension[] = [
    {
      key: 'quality',
      label: '品質',
      tone: qualityGood ? 'good' : qualityWarn ? 'warn' : 'neutral',
      reason: `${s.isFinancial ? 'F 分數不適用（金融業）' : `F 分數 ${f ?? '—'}/9`}、ROE ${pct(roe)}`,
    },
    {
      key: 'growth',
      label: '成長',
      tone: growthGood ? 'good' : growthWarn ? 'warn' : 'neutral',
      reason: `EPS 3 年年化 ${pct(s.epsCagr3y)}、近四季營收年增 ${pct(s.revenueYoyTtm)}`,
    },
    {
      key: 'safety',
      label: '財務安全',
      tone: safetyOk ? 'good' : 'warn',
      reason: s.isFinancial
        ? `金融業（負債比本來就高）${s.currentRatio !== null ? `、流動比率 ${s.currentRatio.toFixed(2)}` : ''}`
        : `負債比 ${pct(s.debtRatio, 0)}、流動比率 ${s.currentRatio?.toFixed(2) ?? '—'}、近 3 年自由現金流 ${negativeFcf} 年為負`,
    },
    {
      key: 'valuation',
      label: '估值',
      tone: valuationTone,
      reason: fair && p ? `現價 ${p}，合理價 ${fair.bear}／${fair.base}／${fair.bull}` : '資料不足，無法估值',
    },
    {
      key: 'dividend',
      label: '股利',
      tone: dividendTone,
      reason: `連續配息 ${s.dividends.consecutiveYears} 年、配息率 ${pct(payout, 0)}`,
    },
  ]
  return { dimensions, ...overallOf(dimensions) }
}
