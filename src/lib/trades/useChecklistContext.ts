import { useAppStore } from '../storage/appStore'
import { useJourney } from '../useJourney'
import { assessMacro } from '../calculations/macroRegime'
import type { ChecklistContext } from '../calculations/preTradeChecklist'

// Everything the pre-trade checklist reads, shared by the trade log and the
// trade plan editor so both run the same checks.
export function useChecklistContext(): ChecklistContext {
  const holdings = useAppStore((s) => s.holdings)
  const theses = useAppStore((s) => s.stockTheses)
  const strategies = useAppStore((s) => s.tradingStrategies)
  const guardrails = useAppStore((s) => s.guardrails)
  const meta = useAppStore((s) => s.portfolioMeta)
  const macroCheckIns = useAppStore((s) => s.macroCheckIns)
  const { policy, journey } = useJourney()
  const latestMacro = [...macroCheckIns].sort((a, b) => b.date.localeCompare(a.date))[0]
  return {
    holdings,
    theses,
    policy,
    guardrails,
    meta,
    macro: latestMacro ? assessMacro(latestMacro, guardrails) : null,
    strategies,
    satelliteGate: {
      unlocked: journey.satelliteUnlocked,
      missingSteps: journey.missingForSatellite.map((s) => `${s.id} ${s.title}`),
    },
  }
}
