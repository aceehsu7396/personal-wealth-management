import { describe, expect, it } from 'vitest'
import { nextSort, sortRows } from './sortRows'

describe('sortRows', () => {
  const rows = [{ v: 3 }, { v: null }, { v: 10 }, { v: 1 }]

  it('sorts numbers either way with missing values last', () => {
    expect(sortRows(rows, (r) => r.v, true).map((r) => r.v)).toEqual([10, 3, 1, null])
    expect(sortRows(rows, (r) => r.v, false).map((r) => r.v)).toEqual([1, 3, 10, null])
  })

  it('sorts text and codes naturally', () => {
    const codes = [{ c: '2330' }, { c: '00878' }, { c: '1101' }]
    expect(sortRows(codes, (r) => r.c, false).map((r) => r.c)).toEqual(['00878', '1101', '2330'])
    const names = [{ n: '鋼鐵' }, { n: 'ETF' }, { n: '半導體' }]
    const order = sortRows(names, (r) => r.n, false).map((r) => r.n)
    // Traditional Chinese collation: by stroke count (半 before 鋼).
    expect(order.indexOf('半導體')).toBeLessThan(order.indexOf('鋼鐵'))
  })

  it('starts numbers largest first and reverses on a second click', () => {
    expect(nextSort(null, 'pe', true)).toEqual({ key: 'pe', desc: true })
    expect(nextSort(null, 'name', false)).toEqual({ key: 'name', desc: false })
    expect(nextSort({ key: 'pe', desc: true }, 'pe', true)).toEqual({ key: 'pe', desc: false })
  })
})
