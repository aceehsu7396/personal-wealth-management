import type { RiskViolation } from '../lib/calculations/portfolioRisk'

const SEVERITY_CLASSES: Record<RiskViolation['severity'], string> = {
  critical: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
  warning:
    'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  info: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
}

export function RiskViolationList({
  violations,
  emptyMessage,
}: {
  violations: RiskViolation[]
  emptyMessage: string
}) {
  if (violations.length === 0) {
    return <p className="text-sm text-indigo-700 dark:text-indigo-400">✓ {emptyMessage}</p>
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
