import { useState } from 'react'
import { formatSymbol } from '../../lib/backtest/templates'
import type { AccountProgress, RoutineProgress, SymbolProgress } from '../../lib/paper/routine'
import { Badge } from '../ui'
import type { Tone } from '../ui/tone'

const SYMBOL_STATUS: Record<SymbolProgress['status'], { tone: Tone; mark: string; label: string }> = {
  pending: { tone: 'info', mark: '…', label: '待更新' },
  fetching: { tone: 'warn', mark: '⟳', label: '更新中' },
  done: { tone: 'good', mark: '✓', label: '已更新' },
  manual: { tone: 'good', mark: '✓', label: '手動價' },
  missing: { tone: 'bad', mark: '✕', label: '取不到' },
}

const ACCOUNT_STATUS: Record<AccountProgress['status'], string> = {
  pending: '等待中',
  prices: '更新收盤價中',
  advising: '產生建議中',
  done: '完成',
  failed: '失敗',
}

const shortDate = (d?: string) => (d ? d.slice(5).replace('-', '/') : '')

// Where 更新收盤價並產生建議 (or 執行今日例行) is: a bar over the symbols,
// each symbol's state and close, and each account's step. Stays after the
// run as its summary, until the next one.
// `detail` is the step under way (a download), so a long step shows movement.
export function RoutineProgressPanel({ progress, detail, compact = false }: { progress: RoutineProgress; detail?: string | null; compact?: boolean }) {
  const [open, setOpen] = useState(!compact)
  const finished = progress.phase === 'finished'
  const total = progress.symbols.length
  const settled = progress.symbols.filter((s) => s.status !== 'pending' && s.status !== 'fetching').length
  const missing = progress.symbols.filter((s) => s.status === 'missing').length
  const accountsDone = progress.accounts.filter((a) => a.status === 'done' || a.status === 'failed').length
  const failed = progress.accounts.filter((a) => a.status === 'failed').length
  const working = progress.accounts.find((a) => a.status === 'prices' || a.status === 'advising')
  // Symbols and accounts both count, so the bar fills only when all is done.
  const steps = total + progress.accounts.length
  const percent = finished ? 100 : steps === 0 ? 0 : Math.round(((settled + accountsDone) / steps) * 100)

  const headline = finished
    ? `完成：${total - missing} 檔已更新${missing > 0 ? `、${missing} 檔取不到` : ''}・${progress.accounts.length - failed} 個帳戶完成${failed > 0 ? `、${failed} 個失敗` : ''}`
    : `${working?.status === 'advising' ? `產生建議中（${working.name}）` : '更新收盤價'} ${settled}／${total} 檔・帳戶 ${accountsDone}／${progress.accounts.length}`

  return (
    <div className="mt-4 rounded-md border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-800" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`font-medium ${finished && (missing > 0 || failed > 0) ? 'text-amber-800 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>{headline}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="ml-auto text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          {open ? '收合明細' : '看明細'}
        </button>
      </div>
      {!finished && detail && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{detail}</p>}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={`h-full rounded-full transition-all ${finished ? 'bg-indigo-600' : 'bg-indigo-400'}`} style={{ width: `${percent}%` }} />
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {progress.symbols.map((s) => {
              const st = SYMBOL_STATUS[s.status]
              return (
                <Badge key={s.symbol} tone={st.tone} title={st.label}>
                  {st.mark} {formatSymbol(s.symbol)}
                  {s.price !== undefined ? ` ${s.price.toLocaleString()}（${shortDate(s.date)}）` : ` ${st.label}`}
                </Badge>
              )
            })}
          </div>
          <ul className="space-y-0.5 text-xs text-gray-700 dark:text-gray-300">
            {progress.accounts.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{a.name}</span>：
                <span className={a.status === 'failed' ? 'text-red-700 dark:text-red-400' : a.status === 'done' ? '' : 'text-indigo-700 dark:text-indigo-300'}>
                  {ACCOUNT_STATUS[a.status]}
                  {a.note && `（${a.note}）`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
