import { ADVICE_LABELS, type Advice, type AdviceLevel } from './advice'

// Advice in three fixed levels (docs/ui-guidelines.md §6). Every item names
// the rule or data it rests on.

const STYLE: Record<AdviceLevel, { border: string; badge: string }> = {
  required: { border: 'border-red-500', badge: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
  suggest: { border: 'border-amber-500', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  notice: { border: 'border-slate-400', badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
}

const ORDER: AdviceLevel[] = ['required', 'suggest', 'notice']

export function AdviceList({ items, empty = '沒有需要注意的事。' }: { items: Advice[]; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level))
  return (
    <ul className="space-y-2">
      {sorted.map((a, i) => (
        <li key={i} className={`border-l-4 bg-white py-1.5 pr-2 pl-3 dark:bg-gray-800 ${STYLE[a.level].border}`}>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STYLE[a.level].badge}`}>{ADVICE_LABELS[a.level]}</span>
            <span className="text-sm text-gray-900 dark:text-gray-100">{a.text}</span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">依據：{a.basis}</p>
        </li>
      ))}
    </ul>
  )
}
