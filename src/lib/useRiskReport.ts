import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from './storage/appStore'
import { useJourney } from './useJourney'
import { useHoldingReturns, type ReturnSource } from './useHoldingReturns'
import { analyzePortfolio, holdingValueTwd } from './calculations/portfolioRisk'
import {
  annualVol,
  beta,
  concentration,
  correlation,
  drawdownStats,
  horizonReturns,
  MONTH_DAYS,
  portfolioReturns,
  riskBudget,
  riskContributions,
  varCvar,
} from './calculations/riskMetrics'
import { applyShock, exposuresOf, HYPOTHETICAL, marketFallTo, type StressResult, type StressScenario } from './calculations/stressTest'
import { fetchStockData } from './screener/stockData'
import { todayIsoDate } from './market/twse'

export const STRESS_DATA_PATH = 'data/stress.json'

async function fetchStress(base: string = import.meta.env.BASE_URL): Promise<StressScenario[]> {
  try {
    const res = await fetch(`${base}${STRESS_DATA_PATH}`, { cache: 'no-cache' })
    if (!res.ok) return []
    const json = (await res.json()) as { scenarios: (Omit<StressScenario, 'us' | 'fx' | 'bond'> & { us: number | null; fx: number | null; bond: number | null })[] }
    // A market without data for that period counts as unchanged.
    return json.scenarios.map((s) => ({ ...s, us: s.us ?? 0, fx: s.fx ?? 0, bond: s.bond ?? 0 }))
  } catch {
    return []
  }
}

export interface PositionRisk {
  id: string
  label: string
  weight: number
  contribution: number
  vol: number
  source: ReturnSource
}

// Everything the risk page shows, from today's holdings and a year of
// daily returns.
export function useRiskReport(custom: StressScenario | null) {
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  const guardrails = useAppStore((s) => s.guardrails)
  const meta = useAppStore((s) => s.portfolioMeta)
  const plans = useAppStore((s) => s.tradePlans)
  const snapshots = useAppStore((s) => s.portfolioSnapshots)
  const foundation = useAppStore((s) => s.foundation)
  const assumptions = useAppStore((s) => s.assumptions)
  const { policy } = useJourney()
  const { market, spx, rows, loading } = useHoldingReturns()
  const [historical, setHistorical] = useState<StressScenario[]>([])
  const [semisCodes, setSemisCodes] = useState<Set<string>>(new Set())

  useEffect(() => {
    void fetchStress().then(setHistorical)
    void fetchStockData().then((d) => setSemisCodes(new Set((d?.stocks ?? []).filter((s) => s.industry.includes('半導體')).map((s) => s.code))))
  }, [])

  return useMemo(() => {
    const today = todayIsoDate()
    const fx = meta.fxUsdTwd
    const analysis = analyzePortfolio(holdings, theses, policy, guardrails, meta)
    const total = analysis.totalValueTwd
    const values = rows.map((r) => holdingValueTwd(r.holding, fx))
    const weights = values.map((v) => (total > 0 ? v / total : 0))
    const matrix = rows.map((r) => r.returns)
    const ready = matrix.length > 0 && (matrix[0]?.length ?? 0) >= 60
    const port = ready ? portfolioReturns(weights, matrix) : []
    const daily = ready ? varCvar(port) : null
    const monthly = ready ? varCvar(horizonReturns(port, MONTH_DAYS)) : null
    const contributions = ready ? riskContributions(weights, matrix) : weights.map(() => 0)

    const betas: Record<string, number | null> = {}
    rows.forEach((r) => {
      const us = r.holding.currency === 'USD'
      betas[r.holding.id] = r.source === 'history' ? beta(r.returns, us ? spx : market) : 1
    })
    const sectorOf = (id: string) => theses.find((t) => t.id === holdings.find((h) => h.id === id)?.thesisId)?.sector ?? ''
    const isSemis = (h: (typeof holdings)[number]) => semisCodes.has(h.ticker) || `${h.sector ?? ''}${sectorOf(h.id)}`.includes('半導體')
    const exposures = exposuresOf(holdings, fx, betas, isSemis)

    const scenarios = [...historical, ...HYPOTHETICAL, ...(custom ? [custom] : [])]
    const results: { scenario: StressScenario; result: StressResult }[] = scenarios.map((scenario) => ({ scenario, result: applyShock(exposures, scenario) }))
    const worstHistorical = results.filter((r) => r.scenario.kind === 'historical').sort((a, b) => a.result.lossTwd - b.result.lossTwd)[0] ?? null

    const dd = drawdownStats(snapshots, total, meta.peakValueTwd, meta.peakDate, today)
    const positions: PositionRisk[] = rows
      .map((r, i) => ({ id: r.holding.id, label: `${r.holding.ticker} ${r.holding.name}`.trim(), weight: weights[i], contribution: contributions[i], vol: annualVol(r.returns), source: r.source }))
      .filter((p) => p.weight > 0)
      .sort((a, b) => b.contribution - a.contribution)
    const top = [...positions].sort((a, b) => b.weight - a.weight).slice(0, 8)
    const byId = new Map(rows.map((r) => [r.holding.id, r.returns]))
    const corr = top.map((a) => top.map((b) => (a.id === b.id ? 1 : correlation(byId.get(a.id)!, byId.get(b.id)!))))
    const yearlyExpenses = assumptions.monthlyExpenses * 12

    return {
      loading,
      ready,
      total,
      vol: ready ? annualVol(port) : null,
      beta: ready ? beta(port, market) : null,
      daily,
      monthly,
      positions,
      correlation: { labels: top.map((t) => t.label), matrix: corr },
      concentration: concentration(weights),
      usdExposurePercent: analysis.usdExposurePercent,
      drawdown: dd,
      results,
      worstHistorical,
      breakerFall: marketFallTo(exposures, dd.current * 100, policy.drawdownCircuitBreakerPercent),
      limitFall: marketFallTo(exposures, dd.current * 100, policy.maxDrawdownTolerancePercent),
      bufferMonths: assumptions.monthlyExpenses > 0 ? foundation.emergencyFundAmount / assumptions.monthlyExpenses : null,
      withdrawalNow: total > 0 && yearlyExpenses > 0 ? (yearlyExpenses / total) * 100 : null,
      withdrawalAfterWorst: worstHistorical && total + worstHistorical.result.lossTwd > 0 && yearlyExpenses > 0 ? (yearlyExpenses / (total + worstHistorical.result.lossTwd)) * 100 : null,
      budget: riskBudget(plans, (total * policy.satellitePercent) / 100, policy, fx),
      proxies: rows.filter((r) => r.source !== 'history').map((r) => `${r.holding.ticker}${r.source === 'proxy' ? '（以指數代替）' : '（視為不波動）'}`),
      policy,
    }
  }, [holdings, theses, guardrails, meta, plans, snapshots, foundation, assumptions, policy, market, spx, rows, loading, historical, semisCodes, custom])
}
