import type { RiskViolation } from '../lib/calculations/portfolioRisk'

const SEVERITY_CLASSES: Record<RiskViolation['severity'], string> = {
  critical: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
  warning:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  info: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
}

export function RiskViolationList({
  violations,
  emptyMessage,
}: {
  violations: RiskViolation[]
  emptyMessage: string
}) {
  if (violations.length === 0) {
    return <p className="text-sm text-emerald-700 dark:text-emerald-400">✓ {emptyMessage}</p>
  }
  return (
    <ul className="space-y-2">
      {violations.map((v, i) => (
        <li key={i} className={`rounded-md border px-3 py-2 text-sm ${SEVERITY_CLASSES[v.severity]}`}>
          <span className="font-medium">【{v.rule}】</span>
          {v.message}
        </li>
      ))}
    </ul>
  )
}
