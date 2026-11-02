import { describe, expect, it } from 'vitest'
import { groupOf, LEGACY_REDIRECTS, NAV_GROUPS } from './navigation'

const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.ts', '../../../docs/strategy/*.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('navigation', () => {
  it('groups pages by workflow, with the handbook and settings at the side', () => {
    expect(NAV_GROUPS.filter((g) => !g.utility).map((g) => g.label)).toEqual(['總覽', '研究', '策略', '投資組合'])
    expect(groupOf('/research/screener')?.id).toBe('research')
    expect(groupOf('/journey')?.id).toBe('overview')
    expect(groupOf('/handbook/12')?.id).toBe('handbook')
  })

  it('redirects old pages to tabs that exist', () => {
    const tabs = NAV_GROUPS.flatMap((g) => g.tabs.map((t) => t.to))
    for (const to of Object.values(LEGACY_REDIRECTS)) expect(tabs).toContain(to)
  })

  it('leaves no old page names in the app or the handbook', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(80)
    const old = /研究分析 ?(→|・)|模擬交易 ?(→|・)|學習路線 ?(→|・)|\/sim\/screener|\/research\/industry/
    const hits = Object.entries(sources)
      .filter(([path]) => !path.endsWith('navigation.ts'))
      .flatMap(([path, text]) => text.split('\n').filter((l) => old.test(l)).map((l) => `${path}: ${l.trim()}`))
    expect(hits).toEqual([])
  })
})
