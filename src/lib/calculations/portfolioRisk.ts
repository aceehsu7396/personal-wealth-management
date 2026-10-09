import type {
  AdviceGuardrails,
  Holding,
  InvestmentPolicy,
  PortfolioMeta,
  Sleeve,
  StockThesis,
} from '../storage/schema'
import { evaluateThesis, positionCapFor, type ThesisEvaluation } from './thesisScoring'
import { expenseLimitFor, isFund } from './fundRules'

export type ViolationSeverity = 'critical' | 'warning' | 'info'

export interface RiskViolation {
  severity: ViolationSeverity
  rule: string
  message: string
}

export interface HoldingView {
  holding: Holding
  valueTwd: number
  weightPercent: number
  gainPercent: number
  thesisEvaluation: ThesisEvaluation | null
  positionCapPercent: number | null
}

export interface SleeveView {
  sleeve: Sleeve
  valueTwd: number
  actualPercent: number
  // Core targets are rescaled so unused satellite budget flows to core
  // proportionally; satellite sleeves have no individual target (null).
  effectiveTargetPercent: number | null
  driftPoints: number | null
}

export interface PortfolioRiskReport {
  totalValueTwd: number
  holdings: HoldingView[]
  sleeves: SleeveView[]
  satellitePercent: number
  usdExposurePercent: number
  sectorExposure: { sector: string; percentOfSatelliteBudget: number }[]
  drawdownPercent: number
  circuitBreakerActive: boolean
  violations: RiskViolation[]
}

export const SLEEVE_LABELS: Record<Sleeve, string> = {
  core_tw: '核心：台股大盤',
  core_global: '核心：美股/全球',
  core_bond_cash: '核心：債券/現金',
  satellite_tw: '衛星：台股個股',
  satellite_us: '衛星：美股個股',
  satellite_fund: '衛星：主動基金',
}

const CORE_SLEEVES: Sleeve[] = ['core_tw', 'core_global', 'core_bond_cash']
const SATELLITE_SLEEVES: Sleeve[] = ['satellite_tw', 'satellite_us', 'satellite_fund']

export function isSatellite(sleeve: Sleeve): boolean {
  return SATELLITE_SLEEVES.includes(sleeve)
}

export function holdingValueTwd(holding: Holding, fxUsdTwd: number): number {
  const fx = holding.currency === 'USD' ? fxUsdTwd : 1
  return holding.shares * holding.currentPrice * fx
}

function coreTargetOf(sleeve: Sleeve, policy: InvestmentPolicy): number {
  if (sleeve === 'core_tw') return policy.coreTwEquityPercent
  if (sleeve === 'core_global') return policy.coreGlobalEquityPercent
  return policy.coreBondCashPercent
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0
}

function fmt(value: number): string {
  return value.toFixed(1)
}

export function analyzePortfolio(
  holdings: Holding[],
  theses: StockThesis[],
  policy: InvestmentPolicy,
  guardrails: AdviceGuardrails,
  meta: PortfolioMeta,
): PortfolioRiskReport {
  const violations: RiskViolation[] = []
  const thesisById = new Map(theses.map((t) => [t.id, t]))

  const totalValueTwd = holdings.reduce((acc, h) => acc + holdingValueTwd(h, meta.fxUsdTwd), 0)

  const holdingViews: HoldingView[] = holdings.map((h) => {
    const valueTwd = holdingValueTwd(h, meta.fxUsdTwd)
    const thesis = h.thesisId ? thesisById.get(h.thesisId) : undefined
    const thesisEvaluation = thesis ? evaluateThesis(thesis, policy) : null
    // Funds are diversified, so the single-stock cap does not apply.
    const positionCapPercent = isSatellite(h.sleeve) && !isFund(h)
      ? thesis && thesisEvaluation
        ? positionCapFor(thesis.lynchCategory, thesisEvaluation.convictionScore, policy)
        : policy.maxSinglePositionPercent
      : null
    return {
      holding: h,
      valueTwd,
      weightPercent: pct(valueTwd, totalValueTwd),
      gainPercent: h.avgCost > 0 ? (h.currentPrice / h.avgCost - 1) * 100 : 0,
      thesisEvaluation,
      positionCapPercent,
    }
  })

  const sleeveValue = (s: Sleeve) =>
    holdingViews.filter((v) => v.holding.sleeve === s).reduce((acc, v) => acc + v.valueTwd, 0)
  const satelliteValue = SATELLITE_SLEEVES.reduce((acc, s) => acc + sleeveValue(s), 0)
  const satellitePercent = pct(satelliteValue, totalValueTwd)

  const coreTargetTotal = CORE_SLEEVES.reduce((acc, s) => acc + coreTargetOf(s, policy), 0)
  const sleeves: SleeveView[] = [...CORE_SLEEVES, ...SATELLITE_SLEEVES].map((s) => {
    const actualPercent = pct(sleeveValue(s), totalValueTwd)
    if (isSatellite(s) || coreTargetTotal <= 0) {
      return { sleeve: s, valueTwd: sleeveValue(s), actualPercent, effectiveTargetPercent: null, driftPoints: null }
    }
    const effectiveTargetPercent = (coreTargetOf(s, policy) / coreTargetTotal) * (100 - satellitePercent)
    return {
      sleeve: s,
      valueTwd: sleeveValue(s),
      actualPercent,
      effectiveTargetPercent,
      driftPoints: actualPercent - effectiveTargetPercent,
    }
  })

  const usdValue = holdingViews
    .filter((v) => v.holding.currency === 'USD')
    .reduce((acc, v) => acc + v.valueTwd, 0)
  const usdExposurePercent = pct(usdValue, totalValueTwd)

  const sectorTotals = new Map<string, number>()
  for (const v of holdingViews) {
    if (!isSatellite(v.holding.sleeve) || isFund(v.holding)) continue
    const thesis = v.holding.thesisId ? thesisById.get(v.holding.thesisId) : undefined
    const sector = (v.holding.sector || thesis?.sector || '未分類').trim()
    sectorTotals.set(sector, (sectorTotals.get(sector) ?? 0) + v.valueTwd)
  }
  // Sector caps are measured against the satellite budget (or the actual
  // satellite if it is larger), so the first few positions are not flagged
  // simply for being the only stock in their sector.
  const satelliteBudget = Math.max(satelliteValue, (totalValueTwd * policy.satellitePercent) / 100)
  const sectorExposure = [...sectorTotals.entries()]
    .map(([sector, value]) => ({ sector, percentOfSatelliteBudget: pct(value, satelliteBudget) }))
    .sort((a, b) => b.percentOfSatelliteBudget - a.percentOfSatelliteBudget)

  const peak = Math.max(meta.peakValueTwd, totalValueTwd)
  const drawdownPercent = peak > 0 ? (totalValueTwd / peak - 1) * 100 : 0
  const circuitBreakerActive = drawdownPercent <= -policy.drawdownCircuitBreakerPercent

  if (totalValueTwd <= 0) {
    return {
      totalValueTwd,
      holdings: holdingViews,
      sleeves,
      satellitePercent,
      usdExposurePercent,
      sectorExposure,
      drawdownPercent,
      circuitBreakerActive,
      violations,
    }
  }

  // Portfolio-level drawdown limits.
  if (drawdownPercent <= -policy.maxDrawdownTolerancePercent) {
    violations.push({
      severity: 'critical',
      rule: '投資政策最大回撤',
      message: `組合自高點回撤 ${fmt(drawdownPercent)}%，超過投資政策容忍度 −${policy.maxDrawdownTolerancePercent}%。年度檢討時須下修股票比重。`,
    })
  }
  if (circuitBreakerActive) {
    violations.push({
      severity: 'critical',
      rule: '回撤熔斷',
      message: `組合自高點回撤 ${fmt(drawdownPercent)}%，觸發熔斷（−${policy.drawdownCircuitBreakerPercent}%）：暫停新增衛星部位、全面複查論點；核心定期定額照常，不得賣出核心。`,
    })
  }

  // Allocation.
  if (satellitePercent > policy.satellitePercent) {
    violations.push({
      severity: 'warning',
      rule: '再平衡',
      message: `衛星占 ${fmt(satellitePercent)}%，超過上限 ${policy.satellitePercent}%：減碼估值最高的衛星持股，轉入核心。`,
    })
  }
  for (const s of sleeves) {
    if (s.driftPoints === null || Math.abs(s.driftPoints) <= guardrails.rebalancingBandPercent) continue
    violations.push({
      severity: 'warning',
      rule: '再平衡',
      message: `${SLEEVE_LABELS[s.sleeve]} 實際 ${fmt(s.actualPercent)}%，目標 ${fmt(s.effectiveTargetPercent!)}%，偏離 ${s.driftPoints > 0 ? '+' : ''}${fmt(s.driftPoints)} 個百分點，超出再平衡帶 ±${guardrails.rebalancingBandPercent}：優先用新資金補低配，其次才賣出。`,
    })
  }
  if (usdExposurePercent > policy.maxUsdExposurePercent) {
    violations.push({
      severity: 'warning',
      rule: '匯率曝險',
      message: `美元資產占 ${fmt(usdExposurePercent)}%，超過上限 ${policy.maxUsdExposurePercent}%：新資金改投台幣資產。`,
    })
  }
  for (const { sector, percentOfSatelliteBudget } of sectorExposure) {
    if (percentOfSatelliteBudget <= policy.maxSectorPercentOfSatellite) continue
    violations.push({
      severity: 'warning',
      rule: '產業集中度',
      message: `「${sector}」占衛星額度 ${fmt(percentOfSatelliteBudget)}%，超過上限 ${policy.maxSectorPercentOfSatellite}%：停止加碼該產業。`,
    })
  }

  // Fund fees: a reminder, not a rule breach.
  for (const v of holdingViews) {
    const fee = v.holding.expenseRatioPercent
    if (!isFund(v.holding) || fee === undefined) continue
    const limit = expenseLimitFor(v.holding.sleeve)
    if (fee <= limit) continue
    violations.push({
      severity: 'info',
      rule: '基金費用',
      message: `${`${v.holding.ticker} ${v.holding.name}`.trim()} 內扣費用率 ${fee}%，高於 ${limit}%：費用每年都會侵蝕報酬，確認它值得這個成本（核心可改用低成本指數工具）。`,
    })
  }

  // Per-holding rules for individual stocks (exit rules ②, ④, ⑤ and
  // research hygiene). Funds are exempt: no research card or stock caps.
  for (const v of holdingViews) {
    if (!isSatellite(v.holding.sleeve) || isFund(v.holding)) continue
    const label = `${v.holding.ticker} ${v.holding.name}`.trim()
    if (v.positionCapPercent !== null && v.weightPercent > v.positionCapPercent) {
      violations.push({
        severity: 'warning',
        rule: '出場規則 ⑤ 超過上限',
        message: `${label} 占 ${fmt(v.weightPercent)}%，超過單檔上限 ${v.positionCapPercent}%：減碼回到上限。`,
      })
    }
    if (v.gainPercent <= -policy.reviewDrawdownFromCostPercent) {
      violations.push({
        severity: 'warning',
        rule: '出場規則 ④ 深度回檔複查',
        message: `${label} 從成本下跌 ${fmt(v.gainPercent)}%：2 週內重寫投資論點；論點不成立則依規則 ① 出場，不得攤平。`,
      })
    }
    if (!v.thesisEvaluation) {
      violations.push({
        severity: 'warning',
        rule: '研究紀律',
        message: `${label} 沒有連結研究卡：衛星持股必須有書面論點與失效條件。`,
      })
      continue
    }
    if (v.thesisEvaluation.priceZone === 'exit_overvalued') {
      violations.push({
        severity: 'warning',
        rule: '出場規則 ② 估值過高',
        message: `${label} 現價高於樂觀合理價 × 1.2：全部出清。`,
      })
    } else if (v.thesisEvaluation.priceZone === 'trim') {
      violations.push({
        severity: 'info',
        rule: '出場規則 ② 估值過高',
        message: `${label} 現價高於樂觀合理價：分 2–3 批減碼至 ½ 部位。`,
      })
    }
    if (!v.thesisEvaluation.isComplete) {
      violations.push({
        severity: 'info',
        rule: '研究紀律',
        message: `${label} 的研究卡尚未完整，請補齊失效條件與事前驗屍。`,
      })
    }
  }

  const order: Record<ViolationSeverity, number> = { critical: 0, warning: 1, info: 2 }
  violations.sort((a, b) => order[a.severity] - order[b.severity])

  return {
    totalValueTwd,
    holdings: holdingViews,
    sleeves,
    satellitePercent,
    usdExposurePercent,
    sectorExposure,
    drawdownPercent,
    circuitBreakerActive,
    violations,
  }
}
