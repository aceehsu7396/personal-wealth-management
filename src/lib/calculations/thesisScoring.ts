import type { InvestmentPolicy, LynchCategory, StockThesis } from '../storage/schema'
import { rateAuto, type AutoRating } from '../research/rating'

// Research cards are scored from the automatic health check only (FinMind
// data) plus the user's one-click verdict.

export type QualityTier = 'high' | 'standard' | 'cyclical'
export type PriceZone = 'strong_buy' | 'buy' | 'hold' | 'trim' | 'exit_overvalued'

export interface ThesisCheck {
  key: string
  label: string
  passed: boolean
}

export interface ThesisEvaluation {
  rating: AutoRating | null
  lynchCategory: LynchCategory
  convictionScore: number
  qualityTier: QualityTier
  marginOfSafetyPercent: number
  buyPrice: number
  expectedValue: number
  upsideDownsideRatio: number
  priceZone: PriceZone
  positionCapPercent: number
  targetPositionPercent: number
  isComplete: boolean
  checks: ThesisCheck[]
  passesAll: boolean
}

export const LYNCH_LABELS: Record<LynchCategory, string> = {
  slow_grower: '緩慢成長',
  stalwart: '穩定成長',
  fast_grower: '快速成長',
  cyclical: '景氣循環',
  turnaround: '轉機',
  asset_play: '資產股',
}

export const PRICE_ZONE_LABELS: Record<PriceZone, string> = {
  strong_buy: '強力買進區',
  buy: '買進區',
  hold: '持有區',
  trim: '減碼區',
  exit_overvalued: '出清區（> 樂觀合理價 × 1.2）',
}

// Probability weights for the bear / base / bull fair values.
const SCENARIO_WEIGHTS = { bear: 0.25, base: 0.5, bull: 0.25 }
const BASE_POSITION_PERCENT = 3
const CYCLICAL_CAP_PERCENT = 3
const TURNAROUND_CAP_PERCENT = 2
const HIGH_CONVICTION_THRESHOLD = 4

// High quality: F-score ≥ 8 and ROE ≥ 15%; cyclicals and turnarounds get
// the thicker margin of safety.
export function qualityTierOf(lynch: LynchCategory, fScore: number | null, roe: number | null): QualityTier {
  if (lynch === 'cyclical' || lynch === 'turnaround') return 'cyclical'
  if ((fScore ?? 0) >= 8 && (roe ?? 0) >= 15) return 'high'
  return 'standard'
}

// Higher quality earns a thinner margin of safety; cyclicals and turnarounds
// need a thicker one. The IPS default applies to standard-quality names.
export function marginOfSafetyFor(
  thesis: StockThesis,
  tier: QualityTier,
  policy: InvestmentPolicy,
): number {
  if (thesis.marginOfSafetyOverridePercent !== undefined) {
    return thesis.marginOfSafetyOverridePercent
  }
  const base = policy.marginOfSafetyPercent
  if (tier === 'high') return Math.max(base - 10, 0)
  if (tier === 'cyclical') return Math.min(base + 10, 90)
  return base
}

export function priceZoneOf(
  price: number,
  bear: number,
  buyPrice: number,
  bull: number,
): PriceZone {
  if (price <= bear) return 'strong_buy'
  if (price <= buyPrice) return 'buy'
  if (price <= bull) return 'hold'
  if (price <= bull * 1.2) return 'trim'
  return 'exit_overvalued'
}

// (bull − price) / (price − bear). Infinite when the price is already at or
// below the bear case; zero or negative when it is above the bull case.
export function upsideDownsideRatioOf(price: number, bear: number, bull: number): number {
  if (price <= bear) return Infinity
  return (bull - price) / (price - bear)
}

export function positionCapFor(
  category: LynchCategory,
  convictionScore: number,
  policy: InvestmentPolicy,
): number {
  if (category === 'cyclical') return Math.min(CYCLICAL_CAP_PERCENT, policy.maxSinglePositionPercent)
  if (category === 'turnaround') {
    return Math.min(TURNAROUND_CAP_PERCENT, policy.maxSinglePositionPercent)
  }
  return convictionScore >= HIGH_CONVICTION_THRESHOLD
    ? policy.maxHighConvictionPositionPercent
    : policy.maxSinglePositionPercent
}

// Simplified half-Kelly: scale a 3% base by conviction and by how asymmetric
// the payoff is, then clamp to the hard cap.
export function targetPositionPercentOf(
  convictionScore: number,
  upsideDownsideRatio: number,
  cap: number,
): number {
  if (upsideDownsideRatio <= 0) return 0
  const asymmetry = Math.min(upsideDownsideRatio / 2, 1.5)
  const raw = BASE_POSITION_PERCENT * (convictionScore / 3) * asymmetry
  return Math.round(Math.min(raw, cap) * 10) / 10
}

export const MARKET_LABELS = { TW: '台股', US: '美股' } as const
export const STATUS_LABELS = { watch: '觀察', holding: '持有', exited: '已出場' } as const

export const VERDICT_LABELS: Record<NonNullable<StockThesis['verdict']>, string> = {
  invest: '值得投資',
  watch: '觀察',
  pass: '不投資',
}

// Minimum ROE (last four quarters) when the automatic check has it.
export const MIN_ROE_PERCENT = 10
// ETFs need enough daily turnover to trade without moving the price (億元).
export const MIN_ETF_TRADE_VALUE = 0.5

const NO_AUTO_CHECK: ThesisCheck = { key: 'auto', label: '需要自動體檢資料（目前只支援台股與 ETF）', passed: false }

export function evaluateThesis(thesis: StockThesis, policy: InvestmentPolicy): ThesisEvaluation {
  const auto = thesis.auto
  const rating = auto ? rateAuto(auto, policy, thesis.currentPrice || undefined) : null
  const isComplete = auto !== undefined && thesis.verdict !== undefined
  const verdictCheck: ThesisCheck = { key: 'verdict', label: '你的結論：值得投資', passed: thesis.verdict === 'invest' }

  if (thesis.kind === 'etf') {
    const tradeValue = auto?.etf?.avgTradeValue ?? null
    const checks: ThesisCheck[] = auto ? [verdictCheck] : [NO_AUTO_CHECK, verdictCheck]
    if (tradeValue !== null) {
      checks.push({
        key: 'liquidity',
        label: `日均成交金額 ≥ ${MIN_ETF_TRADE_VALUE} 億（目前 ${tradeValue.toFixed(2)} 億）`,
        passed: tradeValue >= MIN_ETF_TRADE_VALUE,
      })
    }
    return {
      rating,
      lynchCategory: thesis.lynchCategory,
      convictionScore: 3,
      qualityTier: 'standard',
      marginOfSafetyPercent: 0,
      buyPrice: thesis.currentPrice,
      expectedValue: thesis.currentPrice,
      upsideDownsideRatio: 0,
      priceZone: 'hold',
      positionCapPercent: policy.maxSinglePositionPercent,
      targetPositionPercent: policy.maxSinglePositionPercent,
      isComplete,
      checks,
      passesAll: checks.every((c) => c.passed),
    }
  }

  const stock = auto?.stock ?? null
  const lynch = stock?.lynch ?? thesis.lynchCategory
  // Conviction: one point plus one per dimension rated good (max 5).
  const convictionScore = rating ? Math.min(1 + rating.goodCount, 5) : 1
  const qualityTier = qualityTierOf(lynch, stock?.fScore?.score ?? null, stock?.roe ?? null)
  const marginOfSafetyPercent = marginOfSafetyFor(thesis, qualityTier, policy)
  const buyPrice = thesis.fairValueBase * (1 - marginOfSafetyPercent / 100)
  const expectedValue =
    thesis.fairValueBear * SCENARIO_WEIGHTS.bear +
    thesis.fairValueBase * SCENARIO_WEIGHTS.base +
    thesis.fairValueBull * SCENARIO_WEIGHTS.bull
  const upsideDownsideRatio = upsideDownsideRatioOf(thesis.currentPrice, thesis.fairValueBear, thesis.fairValueBull)
  const priceZone = priceZoneOf(thesis.currentPrice, thesis.fairValueBear, buyPrice, thesis.fairValueBull)
  const positionCapPercent = positionCapFor(lynch, convictionScore, policy)
  const targetPositionPercent = targetPositionPercentOf(convictionScore, upsideDownsideRatio, positionCapPercent)

  const checks: ThesisCheck[] = []
  if (!stock) {
    checks.push(NO_AUTO_CHECK, verdictCheck)
  } else {
    checks.push(verdictCheck)
    // Financials have no F-score (their statements lack gross profit etc.).
    if (stock.fScore) {
      checks.push({ key: 'fScore', label: `F 分數 ≥ 6（目前 ${stock.fScore.score}）`, passed: stock.fScore.score >= 6 })
    }
    if (stock.roe !== null) {
      checks.push({ key: 'roe', label: `ROE ≥ ${MIN_ROE_PERCENT}%（近四季 ${stock.roe.toFixed(1)}%）`, passed: stock.roe >= MIN_ROE_PERCENT })
    }
    checks.push(
      {
        key: 'redFlags',
        label: stock.redFlags.length === 0 ? '沒有財報紅旗' : `沒有財報紅旗（目前 ${stock.redFlags.map((f) => f.label).join('、')}）`,
        passed: stock.redFlags.length === 0,
      },
      { key: 'price', label: `現價 ≤ 買進價（安全邊際 ${marginOfSafetyPercent}%）`, passed: thesis.currentPrice > 0 && thesis.currentPrice <= buyPrice },
      { key: 'asymmetry', label: '上下檔比 ≥ 2', passed: upsideDownsideRatio >= 2 },
    )
  }

  return {
    rating,
    lynchCategory: lynch,
    convictionScore,
    qualityTier,
    marginOfSafetyPercent,
    buyPrice,
    expectedValue,
    upsideDownsideRatio,
    priceZone,
    positionCapPercent,
    targetPositionPercent,
    isComplete,
    checks,
    passesAll: checks.every((c) => c.passed),
  }
}
