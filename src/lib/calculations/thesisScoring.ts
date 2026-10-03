import type { InvestmentPolicy, LynchCategory, StockThesis } from '../storage/schema'

export type QualityTier = 'high' | 'standard' | 'cyclical'
export type PriceZone = 'strong_buy' | 'buy' | 'hold' | 'trim' | 'exit_overvalued'

export interface ThesisCheck {
  key: string
  label: string
  passed: boolean
}

export interface ThesisEvaluation {
  fiveForcesAverage: number
  topPowerScore: number
  strongestPowers: string[]
  industryScore: number
  qualityScore: number
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

export const POWER_LABELS: Record<keyof StockThesis['powers'], string> = {
  scaleEconomies: '規模經濟',
  networkEconomies: '網路效應',
  counterPositioning: '反定位',
  switchingCosts: '轉換成本',
  branding: '品牌',
  corneredResource: '壟斷資源',
  processPower: '流程力',
}

export const FIVE_FORCE_LABELS: Record<keyof StockThesis['fiveForces'], string> = {
  rivalry: '現有競爭強度',
  newEntrants: '新進者威脅',
  substitutes: '替代品威脅',
  buyerPower: '客戶議價力',
  supplierPower: '供應商議價力',
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function average(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

export function qualityTierOf(thesis: StockThesis, topPowerScore: number): QualityTier {
  if (thesis.lynchCategory === 'cyclical' || thesis.lynchCategory === 'turnaround') {
    return 'cyclical'
  }
  if (topPowerScore >= 4 && thesis.fScore >= 8) return 'high'
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

function filled(text: string | undefined): boolean {
  return (text ?? '').trim().length > 0
}

export function evaluateThesis(thesis: StockThesis, policy: InvestmentPolicy): ThesisEvaluation {
  const fiveForcesAverage = average(Object.values(thesis.fiveForces))
  const powerEntries = Object.entries(thesis.powers) as [keyof StockThesis['powers'], number][]
  const topPowerScore = Math.max(...powerEntries.map(([, v]) => v))
  const strongestPowers = powerEntries
    .filter(([, v]) => v >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => POWER_LABELS[k])

  const industryScore = (fiveForcesAverage + clamp(topPowerScore, 1, 5)) / 2

  const hasRoicInputs = thesis.roicPercent !== undefined && thesis.waccPercent !== undefined
  const roicBeatsHurdle = hasRoicInputs && thesis.roicPercent! > thesis.waccPercent! + 3
  let qualityScore = 1 + (thesis.fScore * 4) / 9
  if (hasRoicInputs && !roicBeatsHurdle) qualityScore -= 1
  if (thesis.hasUnexplainedRedFlags) qualityScore -= 1
  qualityScore = clamp(qualityScore, 1, 5)

  const convictionScore = (industryScore + qualityScore) / 2

  const qualityTier = qualityTierOf(thesis, topPowerScore)
  const marginOfSafetyPercent = marginOfSafetyFor(thesis, qualityTier, policy)
  const buyPrice = thesis.fairValueBase * (1 - marginOfSafetyPercent / 100)
  const expectedValue =
    thesis.fairValueBear * SCENARIO_WEIGHTS.bear +
    thesis.fairValueBase * SCENARIO_WEIGHTS.base +
    thesis.fairValueBull * SCENARIO_WEIGHTS.bull
  const upsideDownsideRatio = upsideDownsideRatioOf(
    thesis.currentPrice,
    thesis.fairValueBear,
    thesis.fairValueBull,
  )
  const priceZone = priceZoneOf(
    thesis.currentPrice,
    thesis.fairValueBear,
    buyPrice,
    thesis.fairValueBull,
  )
  const positionCapPercent = positionCapFor(thesis.lynchCategory, convictionScore, policy)
  const targetPositionPercent = targetPositionPercentOf(
    convictionScore,
    upsideDownsideRatio,
    positionCapPercent,
  )

  const isComplete =
    filled(thesis.thesis) &&
    filled(thesis.drivers) &&
    filled(thesis.killCriteria) &&
    filled(thesis.sources) &&
    filled(thesis.preMortem)

  const checks: ThesisCheck[] = [
    { key: 'complete', label: '研究卡完整（論點、驅動因素、失效條件、資訊來源、事前驗屍）', passed: isComplete },
    { key: 'circle', label: '在能力圈內', passed: thesis.inCircleOfCompetence },
    { key: 'fiveForces', label: `五力平均 ≥ 3（目前 ${fiveForcesAverage.toFixed(1)}）`, passed: fiveForcesAverage >= 3 },
    { key: 'powers', label: `至少 1 項 7 Powers ≥ 3（目前最高 ${topPowerScore}）`, passed: topPowerScore >= 3 },
    { key: 'fScore', label: `Piotroski F-Score ≥ 6（目前 ${thesis.fScore}）`, passed: thesis.fScore >= 6 },
  ]
  if (hasRoicInputs) {
    checks.push({ key: 'roic', label: 'ROIC > WACC + 3%', passed: roicBeatsHurdle })
  }
  checks.push({ key: 'redFlags', label: '沒有未解釋的財報紅旗', passed: !thesis.hasUnexplainedRedFlags })
  if (thesis.impliedGrowthPercent !== undefined && thesis.historicalGrowthPercent !== undefined) {
    checks.push({
      key: 'impliedGrowth',
      label: '反向 DCF 隱含成長 ≤ 歷史成長 × 1.2',
      passed: thesis.impliedGrowthPercent <= thesis.historicalGrowthPercent * 1.2,
    })
  }
  checks.push(
    { key: 'price', label: `現價 ≤ 買進價（安全邊際 ${marginOfSafetyPercent}%）`, passed: thesis.currentPrice <= buyPrice },
    { key: 'asymmetry', label: '上下檔比 ≥ 2', passed: upsideDownsideRatio >= 2 },
  )

  return {
    fiveForcesAverage,
    topPowerScore,
    strongestPowers,
    industryScore,
    qualityScore,
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
