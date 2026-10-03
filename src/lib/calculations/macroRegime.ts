import type { AdviceGuardrails, MacroCheckIn, Signal, Trend } from '../storage/schema'

// Growth × inflation quadrants (Dalio / Merrill Lynch investment clock).
// 'mixed' means growth has no clear direction, so no quadrant applies.
export type MacroRegime = 'goldilocks' | 'overheat' | 'stagflation' | 'recession' | 'mixed'

export type MacroStance =
  | 'strong_tailwind'
  | 'tailwind'
  | 'neutral'
  | 'headwind'
  | 'strong_headwind'
  | 'panic_opportunity'

export interface MacroAssessment {
  growthDirection: Trend
  inflationDirection: Trend
  regime: MacroRegime
  liquidityScore: number
  sentimentScore: number
  stance: MacroStance
  tiltMinPoints: number
  tiltMaxPoints: number
  satelliteNewPositionsAllowed: boolean
  actionNote: string
}

export const REGIME_LABELS: Record<MacroRegime, string> = {
  goldilocks: '復甦（成長↑ 通膨↓）',
  overheat: '過熱（成長↑ 通膨↑）',
  stagflation: '停滯性通膨（成長↓ 通膨↑）',
  recession: '衰退（成長↓ 通膨↓）',
  mixed: '訊號混雜（成長方向不明）',
}

export const STANCE_LABELS: Record<MacroStance, string> = {
  strong_tailwind: '強烈順風',
  tailwind: '順風',
  neutral: '中性',
  headwind: '逆風',
  strong_headwind: '強烈逆風',
  panic_opportunity: '恐慌機會',
}

const STANCE_ACTIONS: Record<MacroStance, string> = {
  strong_tailwind: '新資金優先投入股票，衛星可正常建倉。',
  tailwind: '照常執行定期定額與建倉計畫。',
  neutral: '維持策略配置，不做方向性調整。',
  headwind: '新資金優先補債券/現金，衛星暫停新建倉。',
  strong_headwind: '股票傾斜至下限（不得低於股票配置下限），衛星暫停新建倉。',
  panic_opportunity: '情緒極度恐慌：啟用閒置現金分 3 批進場，優先檢查觀察名單中進入強力買進區的標的。',
}

// Majority rule: a direction wins when it covers at least half of the
// indicators and outnumbers the opposite direction.
export function majorityDirection(trends: Trend[]): Trend {
  const ups = trends.filter((t) => t === 'up').length
  const downs = trends.filter((t) => t === 'down').length
  const threshold = Math.ceil(trends.length / 2)
  if (ups >= threshold && ups > downs) return 'up'
  if (downs >= threshold && downs > ups) return 'down'
  return 'flat'
}

export function classifyRegime(growth: Trend, inflation: Trend): MacroRegime {
  if (growth === 'flat') return 'mixed'
  const inflationRising = inflation === 'up'
  if (growth === 'up') return inflationRising ? 'overheat' : 'goldilocks'
  return inflationRising ? 'stagflation' : 'recession'
}

function sum(values: Signal[]): number {
  return values.reduce<number>((acc, v) => acc + v, 0)
}

export function classifyStance(
  regime: MacroRegime,
  liquidityScore: number,
  sentimentScore: number,
): MacroStance {
  // Extreme fear overrides the regime read (Marks: the best buys come when
  // nobody wants to buy).
  if (sentimentScore <= -4) return 'panic_opportunity'
  const adverse = regime === 'stagflation' || regime === 'recession'
  const favorable = regime === 'goldilocks' || regime === 'overheat'
  if (regime === 'goldilocks' && liquidityScore >= 2 && sentimentScore <= 0) {
    return 'strong_tailwind'
  }
  if (adverse && liquidityScore <= -2 && sentimentScore >= 3) return 'strong_headwind'
  if (adverse || liquidityScore <= -2) return 'headwind'
  if (favorable && liquidityScore >= 0) return 'tailwind'
  return 'neutral'
}

function tiltRange(stance: MacroStance, maxTilt: number): [number, number] {
  const half = maxTilt / 2
  switch (stance) {
    case 'strong_tailwind':
      return [half, maxTilt]
    case 'tailwind':
      return [0, half]
    case 'neutral':
      return [0, 0]
    case 'headwind':
      return [-half, -half]
    case 'strong_headwind':
      return [-maxTilt, -maxTilt]
    case 'panic_opportunity':
      return [0, half]
  }
}

export function assessMacro(
  checkIn: MacroCheckIn,
  guardrails: AdviceGuardrails,
): MacroAssessment {
  const growthDirection = majorityDirection(Object.values(checkIn.growth))
  const inflationDirection = majorityDirection(Object.values(checkIn.inflation))
  const regime = classifyRegime(growthDirection, inflationDirection)
  const liquidityScore = sum(Object.values(checkIn.liquidity))
  const sentimentScore = sum(Object.values(checkIn.sentiment))
  const stance = classifyStance(regime, liquidityScore, sentimentScore)
  const [tiltMinPoints, tiltMaxPoints] = tiltRange(stance, guardrails.maxTiltPercent)

  return {
    growthDirection,
    inflationDirection,
    regime,
    liquidityScore,
    sentimentScore,
    stance,
    tiltMinPoints,
    tiltMaxPoints,
    satelliteNewPositionsAllowed: stance !== 'headwind' && stance !== 'strong_headwind',
    actionNote: STANCE_ACTIONS[stance],
  }
}

export function formatTiltRange(min: number, max: number): string {
  const fmt = (v: number) => `${v > 0 ? '+' : ''}${Number(v.toFixed(1))}`
  if (min === 0 && max === 0) return '0（維持策略配置）'
  if (min === max) return `${fmt(min)} 個百分點`
  return `${fmt(min)} ～ ${fmt(max)} 個百分點`
}
