import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPARE_SET } from './compare'
import { STARTER_STRATEGIES } from './starterStrategies'
import { builtInLibrary, cardFromTemplate, compareEntriesOf, defaultLibrary, restoreBuiltIns, WEEKLY_COMPARE_SET, withCompareSet } from './library'

describe('template library', () => {
  it('merges the starters and the comparison set, keeping comparison keys', () => {
    const lib = builtInLibrary()
    expect(lib.filter((t) => t.builtIn && !t.builtIn.startsWith('compare:') && !t.builtIn.startsWith('weekly:'))).toHaveLength(STARTER_STRATEGIES.length)
    // Every default comparison entry is in the library under its key, and
    // the weekly templates (rotation only with several symbols).
    const one = compareEntriesOf(lib, 1)
    const weeklyOne = WEEKLY_COMPARE_SET.filter((e) => e.template !== 'weekly_rotation')
    expect(one.map((e) => e.key).sort()).toEqual([...DEFAULT_COMPARE_SET, ...weeklyOne].map((e) => e.key).sort())
    expect(one.filter((e) => e.cadence === 'weekly')).toHaveLength(3)
    expect(compareEntriesOf(lib, 2).some((e) => e.template === 'weekly_rotation')).toBe(true)
    expect(lib.find((t) => t.id === 'ma_200')?.builtIn).toBe('tw50-200d-filter')
    // The 120-day filter is a starter of its own, not in comparisons.
    expect(lib.find((t) => t.id === 'tw50-120d-filter')).toMatchObject({ params: { fast: 1, slow: 120, atrStop: 0 }, inCompare: false })
  })

  it('adds rotation only with two or more symbols and never a written plan', () => {
    const lib = builtInLibrary()
    expect(compareEntriesOf(lib, 1).some((e) => e.template === 'momentum_rotation')).toBe(false)
    expect(compareEntriesOf(lib, 3).some((e) => e.template === 'momentum_rotation')).toBe(true)
    expect(compareEntriesOf(lib.map((t) => ({ ...t, inCompare: true })), 3).some((e) => e.template === 'discretionary')).toBe(false)
  })

  it('carries a saved comparison set over', () => {
    const custom = { key: 'rsi-x', label: 'RSI 3', template: 'rsi_reversion' as const, params: { rsiDays: 3 }, role: 'signal' as const }
    const lib = defaultLibrary([DEFAULT_COMPARE_SET[2], custom])
    expect(compareEntriesOf(lib, 1).map((e) => e.key)).toEqual(['donchian', 'rsi-x'])
  })

  it('restores only what is missing and keeps edits', () => {
    const lib = builtInLibrary().filter((t) => t.id !== 'donchian').map((t) => (t.id === 'ma_200' ? { ...t, name: '我的 200 日線' } : t))
    const back = restoreBuiltIns(lib)
    expect(back.find((t) => t.id === 'donchian')).toBeDefined()
    expect(back.find((t) => t.id === 'ma_200')?.name).toBe('我的 200 日線')
    expect(back).toHaveLength(builtInLibrary().length)
  })

  it('makes a card on the compared symbol when the entry has none', () => {
    const t = builtInLibrary().find((x) => x.id === 'buy_hold')!
    expect(cardFromTemplate(t, ['TW:2330'], 1)).toMatchObject({ name: '買進持有・2330', symbols: ['TW:2330'], status: 'dev' })
  })
})

describe('withCompareSet', () => {
  it('saves new parameters, unticks and additions', () => {
    const lib = builtInLibrary()
    const entries = compareEntriesOf(lib, 1).map((e) => (e.key === 'donchian' ? { ...e, params: { ...e.params, entryDays: 40 } } : e))
    const extra = { key: 'rsi-x', label: 'RSI 3', template: 'rsi_reversion' as const, params: { rsiDays: 3 }, role: 'signal' as const }
    const next = withCompareSet(lib, [...entries, extra], ['ma_cross'])
    expect(next.find((t) => t.id === 'donchian')?.params.entryDays).toBe(40)
    expect(next.find((t) => t.id === 'ma_cross')?.inCompare).toBe(false)
    expect(next.at(-1)).toMatchObject({ id: 'rsi-x', name: 'RSI 3', inCompare: true })
  })
})
