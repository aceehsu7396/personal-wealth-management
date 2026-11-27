import { useState } from 'react'
import { useAppStore } from '../storage/appStore'
import { useJourney } from '../useJourney'
import { useRegime } from '../market/useRegime'
import { todayIsoDate } from '../market/twse'
import { runPaperRoutine, type RoutineProgress, type RoutineResult } from './routine'
import { claimRoutine, releaseRoutine } from './autoRoutine'

// The paper accounts' daily work (closes, then suggestions) with its
// progress; shared by 執行今日例行 and the automatic run after the close.
export function useRoutineRunner() {
  const strategies = useAppStore((s) => s.tradingStrategies)
  const replacePaperAccount = useAppStore((s) => s.replacePaperAccount)
  const setRanAt = useAppStore((s) => s.setPaperRoutineRanAt)
  const weeklyDecisionDay = useAppStore((s) => s.tradingPrefs?.weeklyDecisionDay)
  const { policy } = useJourney()
  // Suggestions use the regime's stop width and multiplier: wait for it.
  const { ctx: regime, loading: regimeLoading } = useRegime()
  const [step, setStep] = useState<string | null>(null)
  const [progress, setProgress] = useState<RoutineProgress | null>(null)
  const [result, setResult] = useState<RoutineResult | null>(null)

  // False when another run (a button, or the automatic one) is under way.
  async function run(): Promise<boolean> {
    if (!claimRoutine()) return false
    setResult(null)
    setProgress(null)
    setStep('開始…')
    try {
      const accounts = useAppStore.getState().paperAccounts
      const res = await runPaperRoutine({
        accounts,
        strategies,
        policy,
        regime,
        today: todayIsoDate(),
        onStep: setStep,
        weeklyDecisionDay,
        latest: (id) => useAppStore.getState().paperAccounts.find((a) => a.id === id)!,
        funds: useAppStore.getState().paperFunds,
        save: replacePaperAccount,
        onProgress: setProgress,
      })
      setResult(res)
      setRanAt(new Date().toISOString())
    } finally {
      setStep(null)
      releaseRoutine()
    }
    return true
  }

  return { run, step, progress, result, regimeLoading }
}
