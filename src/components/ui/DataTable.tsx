import { useState } from 'react'
import { SortableTh } from '../SortableTh'
import { nextSort, sortRows, type SortState, type SortValue } from '../../lib/sortRows'

export interface Column<T> {
  key: string
  label: string
  render: (row: T) => React.ReactNode
  // Present to make the column sortable.
  sortValue?: (row: T) => SortValue
  numeric?: boolean
}

// A table that shows the first rows and folds the rest (docs/ui-guidelines.md
// §4); sortable columns use the shared header.
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  limit = 10,
  empty = '沒有資料。',
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  limit?: number
  empty?: string
}) {
  const [sort, setSort] = useState<SortState<string> | null>(null)
  const [all, setAll] = useState(false)
  if (rows.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined
  const sorted = col?.sortValue && sort ? sortRows(rows, col.sortValue, sort.desc) : rows
  const shown = all ? sorted : sorted.slice(0, limit)
  const th = 'py-2 pr-4 text-left text-xs font-medium whitespace-nowrap text-gray-500 dark:text-gray-400'
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {columns.map((c) =>
                c.sortValue ? (
                  <SortableTh
                    key={c.key}
                    sortKey={c.key}
                    label={c.label}
                    sort={sort}
                    onSort={(k) => setSort((s) => nextSort(s, k, c.numeric ?? false))}
                    className={`${th} ${c.numeric ? 'text-right' : ''}`}
                  />
                ) : (
                  <th key={c.key} className={`${th} ${c.numeric ? 'text-right' : ''}`}>
                    {c.label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                {columns.map((c) => (
                  <td key={c.key} className={`py-2 pr-4 text-gray-700 dark:text-gray-300 ${c.numeric ? 'text-right tabular-nums' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400">
          {all ? `只顯示前 ${limit} 列` : `顯示全部 ${rows.length} 列`}
        </button>
      )}
    </div>
  )
}
