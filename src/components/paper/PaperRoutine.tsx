import { useAppStore } from '../../lib/storage/appStore'
import { describeAiError } from '../../lib/ai/client'
import { routineAccounts } from '../../lib/paper/routine'
import { useRoutineRunner } from '../../lib/paper/useRoutineRunner'
import { RoutineProgressPanel } from './RoutineProgressPanel'
import { AutoRanNote } from './AutoPaperRoutine'
import { secondaryButton } from '../ui'

// One button on the 今日 page for the paper accounts' daily work: prices,
// then suggestions. It also runs by itself after each close (AutoPaperRoutine);
// acting on the suggestions stays on the paper page.
export function PaperRoutine() {
  const accounts = useAppStore((s) => s.paperAccounts)
  const strategies = useAppStore((s) => s.tradingStrategies)
  const { run, step, progress, result, regimeLoading } = useRoutineRunner()
  // Every account gets the latest closes; paper cards also get suggestions.
  const count = accounts.length
  const advised = routineAccounts(accounts, strategies).length
  if (count === 0) return null

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-gray-600 dark:text-gray-400">
        {!step && !result && (
          <span>
            {regimeLoading ? '讀取局勢中…' : `虛擬交易 ${count} 個策略：更新收盤價${advised > 0 ? `，${advised} 個產生建議` : ''}`}
            <AutoRanNote />
          </span>
        )}
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
