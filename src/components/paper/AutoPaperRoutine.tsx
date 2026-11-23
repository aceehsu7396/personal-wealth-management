import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { describeAiError } from '../../lib/ai/client'
import { isDemoActive } from '../../lib/demo/demoMode'
import { CHECK_EVERY_MS, routineDue, routineRunning, taipeiDate } from '../../lib/paper/autoRoutine'
import { useRoutineRunner } from '../../lib/paper/useRoutineRunner'
import { RoutineProgressPanel } from './RoutineProgressPanel'

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })

// 「上次更新 11/23 15:02」 next to the routine's buttons.
export function AutoRanNote() {
  const ranAt = useAppStore((s) => s.paperRoutineRanAt)
  if (!ranAt) return null
  return <span className="ml-1">・上次更新 {taipeiDate(ranAt).slice(5).replace('-', '/')} {timeOf(ranAt)}</span>
}

// Mounted once in the app shell: after each trading day's close (14:30),
// the first page opened, or one left open, runs 更新收盤價並產生建議 by
// itself (handbook 10 §7). A small panel shows the progress and stays
// with the summary until closed.
export function AutoPaperRoutine() {
  const hasAccounts = useAppStore((s) => s.paperAccounts.length > 0)
  const ranAt = useAppStore((s) => s.paperRoutineRanAt)
  const [now, setNow] = useState(() => new Date())
  const [active, setActive] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), CHECK_EVERY_MS)
    return () => window.clearInterval(id)
  }, [])

  const due = hasAccounts && !isDemoActive() && routineDue(now, ranAt) && !routineRunning()
  useEffect(() => {
    if (due) setActive(true)
  }, [due])

  return active ? <Runner onClose={() => setActive(false)} /> : null
}

function Runner({ onClose }: { onClose: () => void }) {
  const { run, step, progress, result, regimeLoading } = useRoutineRunner()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current || regimeLoading) return
    started.current = true
    run()
      .then((ran) => {
        // A button got there first: nothing to show.
        if (!ran) onClose()
      })
      .catch((e) => setError(describeAiError(e)))
  }, [regimeLoading, run, onClose])

  const finished = progress?.phase === 'finished' || !!error
  return (
    <div className="fixed bottom-4 left-4 z-40 w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">收盤後自動更新虛擬帳戶</p>
        {finished && (
          <button type="button" onClick={onClose} className="ml-auto text-xs font-medium text-gray-600 hover:underline dark:text-gray-400" aria-label="關閉">
            關閉
          </button>
        )}
      </div>
      {!progress && !error && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{regimeLoading ? '讀取局勢中…' : (step ?? '準備中…')}</p>}
      {progress && <RoutineProgressPanel progress={progress} detail={step} compact />}
      {error && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
      {result && result.failed.length > 0 && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{result.failed.map((f) => `${f.name} 失敗：${describeAiError(f.error)}`).join('；')}</p>}
      {finished && (
        <Link to="/sim/paper" onClick={onClose} className="mt-2 inline-block text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          到虛擬帳戶看建議 →
        </Link>
      )}
    </div>
  )
}
