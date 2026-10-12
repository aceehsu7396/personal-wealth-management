import type { TraderReadiness } from '../lib/calculations/traderReadiness'

// The five full-time gates with their current values.
export function ReadinessChecklist({ readiness }: { readiness: TraderReadiness }) {
  return (
    <ul className="space-y-2 text-sm">
      {readiness.items.map((item) => (
        <li key={item.key}>
          <p className={item.met ? 'font-medium text-indigo-700 dark:text-indigo-400' : 'font-medium text-gray-900 dark:text-gray-100'}>
            {item.met ? '✓' : '☐'} {item.label}
          </p>
          <p className="ml-5 text-xs text-gray-500 dark:text-gray-400">{item.detail}</p>
        </li>
      ))}
    </ul>
  )
}
