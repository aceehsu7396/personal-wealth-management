import { useState } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { useJourney } from '../../lib/useJourney'
import { useRegime } from '../../lib/market/useRegime'
import { todayIsoDate } from '../../lib/market/twse'
import { describeAiError } from '../../lib/ai/client'
import { routineAccounts, runPaperRoutine, type RoutineProgress, type RoutineResult } from '../../lib/paper/routine'
import { RoutineProgressPanel } from './RoutineProgressPanel'
import { secondaryButton } from '../ui'

// One button on the 今日 page for the paper accounts' daily work: prices,
// then suggestions. Acting on them stays on the paper page.
export function PaperRoutine() {
  const accounts = useAppStore((s) => s.paperAccounts)
  const strategies = useAppStore((s) => s.tradingStrategies)
  const replacePaperAccount = useAppStore((s) => s.replacePaperAccount)
  const weeklyDecisionDay = useAppStore((s) => s.tradingPrefs?.weeklyDecisionDay)
  const { policy } = useJourney()
  // Suggestions use the regime's stop width and multiplier: wait for it.
  const { ctx: regime, loading: regimeLoading } = useRegime()
  const [step, setStep] = useState<string | null>(null)
  const [result, setResult] = useState<RoutineResult | null>(null)
  const [progress, setProgress] = useState<RoutineProgress | null>(null)
  // Every account gets the latest closes; paper cards also get suggestions.
  const count = accounts.length
  const advised = routineAccounts(accounts, strategies).length
  if (count === 0) return null

  async function run() {
    setResult(null)
    setProgress(null)
    setStep('開始…')
    try {
      setResult(
        await runPaperRoutine({
          accounts,
          strategies,
          policy,
          regime,
          today: todayIsoDate(),
          onStep: setStep,
          weeklyDecisionDay,
          latest: (id) => useAppStore.getState().paperAccounts.find((a) => a.id === id)!,
          save: replacePaperAccount,
          onProgress: setProgress,
        }),
      )
    } finally {
      setStep(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-gray-600 dark:text-gray-400">
        {!step && !result && <span>{regimeLoading ? '讀取局勢中…' : `虛擬帳戶 ${count} 個：更新收盤價${advised > 0 ? `，${advised} 個產生建議` : ''}`}</span>}
        <button type="button" className={secondaryButton} disabled={step !== null || regimeLoading} onClick={() => void run()}>
          執行今日例行
        </button>
      </div>
      {progress && <RoutineProgressPanel progress={progress} detail={step} compact />}
      {result && result.failed.length > 0 && (
        <p className="mt-2 text-right text-xs text-red-700 dark:text-red-400">{result.failed.map((f) => `${f.name} 失敗：${describeAiError(f.error)}`).join('；')}</p>
      )}
    </div>
  )
}
