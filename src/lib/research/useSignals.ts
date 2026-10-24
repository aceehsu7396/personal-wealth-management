import { useAppStore } from '../storage/appStore'
import { assessMacro } from '../calculations/macroRegime'
import { analyzePortfolio } from '../calculations/portfolioRisk'
import type { ThesisEvaluation } from '../calculations/thesisScoring'
import type { StockThesis } from '../storage/schema'
import { buildSignals, heldPositionOf, type SignalReport } from './signals'

// Everything the entry/exit advice needs besides the card: this month's
// macro stance, the holdings and the portfolio size.
export function useSignals(): (thesis: StockThesis, evaluation: ThesisEvaluation) => SignalReport {
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const guardrails = useAppStore((s) => s.guardrails)
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  const policy = useAppStore((s) => s.investmentPolicy)
  const meta = useAppStore((s) => s.portfolioMeta)

  const latest = [...macroCheckIns].sort((a, b) => b.date.localeCompare(a.date))[0]
  const macro = latest ? assessMacro(latest, guardrails) : null
  const totalValueTwd = analyzePortfolio(holdings, theses, policy, guardrails, meta).totalValueTwd

  return (thesis, evaluation) =>
    buildSignals({
      thesis,
      evaluation,
      macro,
      holding: heldPositionOf(thesis.ticker, holdings, totalValueTwd, meta.fxUsdTwd),
      totalValueTwd,
      policy,
    })
}
