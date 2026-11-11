import { describe, expect, it } from 'vitest'
import { groupOf, HOME_PATH, LEGACY_REDIRECTS, NAV_GROUPS } from './navigation'

const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.ts', '../../../docs/strategy/*.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('navigation', () => {
  it('groups pages into the three areas (plus the temporary blueprint), with notes, the handbook and settings at the side', () => {
    expect(NAV_GROUPS.filter((g) => !g.utility).map((g) => g.label)).toEqual(['研究分析', '模擬交易', '投資持有與檢討回顧', '系統藍圖'])
    expect(NAV_GROUPS.filter((g) => g.utility).map((g) => g.id)).toEqual(['notes', 'handbook', 'settings'])
    expect(groupOf('/research/screener')?.id).toBe('research')
    expect(groupOf('/today')?.id).toBe('portfolio')
    expect(groupOf('/goals')?.id).toBe('portfolio')
    expect(groupOf('/journey')?.id).toBe('handbook')
    expect(groupOf('/handbook/12')?.id).toBe('handbook')
    expect(groupOf('/notes')?.id).toBe('notes')
    expect(groupOf('/blueprint/03')?.id).toBe('blueprint')
  })

  it('opens on the first area', () => {
    expect(HOME_PATH).toBe(NAV_GROUPS[0].to)
  })

  it('redirects old pages to tabs that exist', () => {
    const tabs = NAV_GROUPS.flatMap((g) => g.tabs.map((t) => t.to))
    for (const to of Object.values(LEGACY_REDIRECTS)) expect(tabs).toContain(to)
  })

  it('leaves no old page names in the app or the handbook', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(80)
    const old = /(?<!\p{Script=Han})(總覽|研究|策略|投資組合) ?(→|・) ?(今日|行動路線|目標與政策|市場|選股|研究卡|策略卡|回測|虛擬帳戶|持股與風控|交易日誌|績效歸因)|學習路線 ?(→|・)|\/sim\/screener|\/research\/industry/u
    const hits = Object.entries(sources)
      .filter(([path]) => !path.endsWith('navigation.ts'))
      .flatMap(([path, text]) => text.split('\n').filter((l) => old.test(l)).map((l) => `${path}: ${l.trim()}`))
    expect(hits).toEqual([])
  })
})
