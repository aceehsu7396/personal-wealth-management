import { useState } from 'react'
import { useAppStore } from '../../lib/storage/appStore'
import { REVIEW_QUESTIONS, type PauseStatus } from '../../lib/calculations/tradingPause'
import { todayIsoDate } from '../../lib/market/twse'
import { inputClass } from '../forms/FormField'
import { secondaryButton } from '../ui'

type Checks = Record<(typeof REVIEW_QUESTIONS)[number]['key'], boolean>

// The review that lifts a losing-streak pause (handbook 04 §8).
export function PauseReviewForm({ pause }: { pause: PauseStatus }) {
  const add = useAppStore((s) => s.addPauseReview)
  const [checks, setChecks] = useState<Checks>({ followedStops: false, regimeChanged: false, strategyStillValid: false, sizeTooLarge: false })
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    if (notes.trim().length < 10) return setError('請寫下至少一句心得：這幾筆虧損的共同原因，和接下來要改什麼。')
    add({ date: todayIsoDate(), streak: pause.streak, checks, notes: notes.trim() })
    setNotes('')
    setError(null)
  }
  return (
    <div id="pause-review" className="scroll-mt-4 rounded-md border border-red-200 p-4 dark:border-red-900">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">暫停檢討（連續虧損 {pause.streak} 筆）</p>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">勾選符合的情況，寫下心得後送出；連續虧損從今天重新計算。</p>
      <div className="mt-3 space-y-1.5">
        {REVIEW_QUESTIONS.map((q) => (
          <label key={q.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={checks[q.key]} onChange={(e) => setChecks({ ...checks, [q.key]: e.target.checked })} />
            {q.label}
          </label>
        ))}
      </div>
      <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
        心得
        <textarea rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>}
      <button type="button" className={`mt-3 ${secondaryButton}`} onClick={submit}>
        送出暫停檢討
      </button>
    </div>
  )
}
