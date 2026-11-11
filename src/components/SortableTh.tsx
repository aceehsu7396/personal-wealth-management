import type { SortState } from '../lib/sortRows'

// A table header that sorts by its column. The whole cell is clickable; the
// arrow is the keyboard control. The label may hold its own button (a
// glossary term), so clicks on buttons inside it do not sort.
export function SortableTh<K extends string>({
  sortKey,
  label,
  sort,
  onSort,
  className,
  children,
}: {
  sortKey: K
  label: string
  sort: SortState<K> | null
  onSort: (key: K) => void
  className?: string
  children?: React.ReactNode
}) {
  const active = sort?.key === sortKey
  return (
    <th
      className={`${className ?? ''} cursor-pointer select-none`}
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) onSort(sortKey)
      }}
    >
      <span className={`inline-flex items-center gap-0.5 ${active ? 'text-indigo-700 dark:text-indigo-400' : ''}`}>
        {children ?? label}
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          aria-label={`依${label}排序`}
          className={`px-0.5 text-xs leading-none hover:text-gray-900 dark:hover:text-gray-100 ${active ? '' : 'opacity-40'}`}
        >
          {active ? (sort.desc ? '▼' : '▲') : '↕'}
        </button>
      </span>
    </th>
  )
}
