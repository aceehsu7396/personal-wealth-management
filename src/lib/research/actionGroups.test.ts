import { describe, expect, it } from 'vitest'
import { actionGroupOf, groupItems, matchesQuery, openByDefault } from './actionGroups'

describe('action groups', () => {
  it('sorts actions into groups', () => {
    expect(actionGroupOf('trim')).toBe('act')
    expect(actionGroupOf('review')).toBe('act')
    expect(actionGroupOf('buy')).toBe('enter')
    expect(actionGroupOf('add')).toBe('enter')
    expect(actionGroupOf('wait')).toBe('wait')
    expect(actionGroupOf('avoid')).toBe('avoid')
    expect(actionGroupOf(null)).toBe('unchecked')
    expect(actionGroupOf('buy', true)).toBe('exited')
  })

  it('orders groups, drops empty ones and keeps item order', () => {
    const items = [
      { id: 'a', action: 'wait' as const },
      { id: 'b', action: 'exit' as const },
      { id: 'c', action: 'wait' as const },
    ]
    const groups = groupItems(items, (i) => actionGroupOf(i.action))
    expect(groups.map((g) => g.key)).toEqual(['act', 'wait'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('opens every group in a short list or a search, else the urgent ones', () => {
    expect(openByDefault('hold', 10, false)).toBe(true)
    expect(openByDefault('hold', 11, false)).toBe(false)
    expect(openByDefault('wait', 30, false)).toBe(true)
    expect(openByDefault('exited', 30, true)).toBe(true)
  })

  it('matches a search in any text', () => {
    expect(matchesQuery('', ['x'])).toBe(true)
    expect(matchesQuery('tsm', ['2330', 'TSMC'])).toBe(true)
    expect(matchesQuery('半導', ['2330', undefined, '半導體業'])).toBe(true)
    expect(matchesQuery('2317', ['2330'])).toBe(false)
  })
})
