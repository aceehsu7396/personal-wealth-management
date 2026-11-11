// Table sorting by a clicked column: numbers or text, with missing values
// always last whichever way the column is sorted.

export type SortValue = number | string | null | undefined

export interface SortState<K extends string> {
  key: K
  desc: boolean
}

const text = new Intl.Collator('zh-Hant', { numeric: true })

export function sortRows<T>(rows: T[], value: (row: T) => SortValue, desc: boolean): T[] {
  return [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    const missingA = va === null || va === undefined || (typeof va === 'number' && !Number.isFinite(va))
    const missingB = vb === null || vb === undefined || (typeof vb === 'number' && !Number.isFinite(vb))
    if (missingA || missingB) return Number(missingA) - Number(missingB)
    const order = typeof va === 'number' && typeof vb === 'number' ? va - vb : text.compare(String(va), String(vb))
    return desc ? -order : order
  })
}

// A first click sorts numbers largest first and text A→Z; clicking the
// same column again reverses it.
export function nextSort<K extends string>(current: SortState<K> | null, key: K, numeric: boolean): SortState<K> {
  if (current?.key === key) return { key, desc: !current.desc }
  return { key, desc: numeric }
}
