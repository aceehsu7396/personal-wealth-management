import { useMemo } from 'react'
import { useAppStore } from '../storage/appStore'
import { assessMacro, type MacroAssessment } from '../calculations/macroRegime'
import { todayIsoDate } from './twse'
import { useDailyMarket } from './useDailyMarket'
import { useMacroData } from '../macro/useMacroData'
import { useValuation } from './valuation'
import { facetScores, regimeContext, regimeHistory, type Facet, type RegimeContext, type RegimeHistory } from './regime'

export interface RegimeView {
  history: RegimeHistory | null
  ctx: RegimeContext | null
  facets: Facet[]
  macro: MacroAssessment | null
  // TAIEX drawdown from its 52-week high, in %, for the dip ladder.
  drawdown: number | null
  // Last session the TAIEX closed at a 52-week high.
  lastHigh: string | null
  loading: boolean
}

export function useLatestMacro(): MacroAssessment | null {
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const guardrails = useAppStore((s) => s.guardrails)
  return useMemo(() => {
    const latest = [...macroCheckIns].sort((a, b) => b.date.localeCompare(a.date))[0]
    return latest ? assessMacro(latest, guardrails) : null
  }, [macroCheckIns, guardrails])
}

// The market regime and its parameter row, shared by the market page, the
// daily scan, trade plans and the pre-trade checklist.
export function useRegime(): RegimeView {
  const { data, trends, usBreadth, loading } = useDailyMarket()
  const params = useAppStore((s) => s.regimeParams)
  const macro = useLatestMacro()
  const macroData = useMacroData()
  const valuation = useValuation()
  const taiex = data?.series.TAIEX
  const vix = data?.series.VIX
  const history = useMemo(() => (taiex && taiex.length > 0 ? regimeHistory(taiex, vix ?? []) : null), [taiex, vix])
  const ctx = useMemo(() => (history ? regimeContext(history, params, macro, todayIsoDate()) : null), [history, params, macro])
  const facets = useMemo(
    () =>
      facetScores({
        taiex: trends.TAIEX ?? null,
        vix: trends.VIX ?? null,
        breadth: data?.breadth ?? null,
        usBreadth,
        flows: data?.flows ?? [],
        margin: data?.margin ?? [],
        macro,
        macroData,
        valuation,
      }),
    [trends, data, usBreadth, macro, macroData, valuation],
  )
  const lastHigh = useMemo(() => {
    if (!taiex) return null
    let high = -Infinity
    let at: string | null = null
    for (const p of taiex.slice(-252)) {
      if (p.close >= high) {
        high = p.close
        at = p.date
      }
    }
    return at
  }, [taiex])
  return { history, ctx, facets, macro, drawdown: trends.TAIEX?.drawdown ?? null, lastHigh, loading }
}
