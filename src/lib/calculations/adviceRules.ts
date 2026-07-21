import type {
  AdviceGuardrails,
  InterestRateLevel,
  MarketCheckIn,
  MarketPhase,
  ValuationZone,
} from '../storage/schema'

export interface AdviceRuleResult {
  checkInId: string
  generatedAt: string
  rebalancingSuggestion: string
  dcaPacingSuggestion: string
  allocationTiltSuggestion: string
  phaseNote: string
  rateNote: string
  disclaimer: string
}

export const DISCLAIMER =
  '本建議僅供長期資產配置參考，非個股或短線交易建議，請依個人風險承受度調整，不構成投資建議。'

interface ValuationRule {
  rebalancingBandMultiplier: number
  dcaPacingSuggestion: string
  tiltDirection: -1 | 0 | 1
}

const VALUATION_RULES: Record<ValuationZone, ValuationRule> = {
  undervalued: {
    rebalancingBandMultiplier: 1,
    dcaPacingSuggestion:
      '維持既定定期定額，若不影響緊急預備金，可考慮溫和加碼（+10%~20%）。',
    tiltDirection: 1,
  },
  fair: {
    rebalancingBandMultiplier: 1,
    dcaPacingSuggestion: '維持既定定期定額，不需調整。',
    tiltDirection: 0,
  },
  overvalued: {
    rebalancingBandMultiplier: 0.6,
    dcaPacingSuggestion: '維持既定定期定額，不停扣、不擇時進出。',
    tiltDirection: -1,
  },
  extremely_overvalued: {
    rebalancingBandMultiplier: 0.6,
    dcaPacingSuggestion:
      '維持既定定期定額；新資金可優先補進目前配置不足的資產類別。',
    tiltDirection: -1,
  },
  unsure: {
    rebalancingBandMultiplier: 1,
    dcaPacingSuggestion: '維持既定定期定額，待有更明確判斷後再考慮調整。',
    tiltDirection: 0,
  },
}

const PHASE_NOTES: Record<MarketPhase, string> = {
  bull_early: '牛市初期，長期配置紀律優先，避免追高減碼。',
  bull_late: '牛市末端，抗拒追逐績效的誘惑，嚴守再平衡紀律。',
  bear: '空頭階段，長期投資人通常在此階段被獎勵，維持紀律並考慮利用閒置資金分批進場。',
  recovery: '市場回升初期，避免因擔心錯過反彈而追高，依原計畫執行即可。',
  sideways: '盤整階段，維持原定計畫，不需額外調整。',
  unsure: '市場階段尚不明朗，暫不因單一觀察大幅調整配置。',
}

const RATE_NOTES: Record<InterestRateLevel, string> = {
  low: '利率偏低，持有目標債券／現金配置的機會成本較低。',
  neutral: '利率處於中性水準，債券／現金配置維持原比例即可。',
  high: '利率偏高，閒置資金停泊在計息工具的吸引力較高，可留意將待部署資金放在能生息的帳戶。',
  unsure: '利率水準判斷不明確，暫不因此調整債券／現金配置。',
}

function tiltSuggestion(tiltDirection: -1 | 0 | 1, guardrails: AdviceGuardrails): string {
  if (tiltDirection === 0) return '維持目標資產配置，不做方向性調整。'
  if (tiltDirection > 0) {
    return `可上調股票配置，最多不超過目標 +${guardrails.maxTiltPercent} 個百分點。`
  }
  return `可下調股票配置，最多不超過目標 -${guardrails.maxTiltPercent} 個百分點，且股票配置不得低於下限 ${guardrails.minEquityFloorPercent}%。`
}

export function computeAdvice(
  checkIn: MarketCheckIn,
  guardrails: AdviceGuardrails,
): AdviceRuleResult {
  const rule = VALUATION_RULES[checkIn.valuationZone]
  const band = (guardrails.rebalancingBandPercent * rule.rebalancingBandMultiplier).toFixed(1)
  const tightened = rule.rebalancingBandMultiplier < 1

  return {
    checkInId: checkIn.id,
    generatedAt: new Date().toISOString(),
    rebalancingSuggestion: tightened
      ? `再平衡帶收緊至 ±${band}%，超出即優先執行再平衡。`
      : `再平衡帶維持標準 ±${band}%，超出即執行再平衡。`,
    dcaPacingSuggestion: rule.dcaPacingSuggestion,
    allocationTiltSuggestion: tiltSuggestion(rule.tiltDirection, guardrails),
    phaseNote: PHASE_NOTES[checkIn.marketPhase],
    rateNote: RATE_NOTES[checkIn.interestRateLevel],
    disclaimer: DISCLAIMER,
  }
}
