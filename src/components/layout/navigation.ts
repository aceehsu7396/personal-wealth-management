// Top-level navigation: five groups, each with its own sub-tabs.

export interface NavTab {
  label: string
  to: string
  // Exact tabs match only their own path (e.g. "/" or "/portfolio");
  // others also match sub-paths (e.g. "/handbook/03").
  exact?: boolean
}

export interface NavGroup {
  id: 'overview' | 'learn' | 'research' | 'portfolio' | 'settings'
  label: string
  to: string
  tabs: NavTab[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: '總覽',
    to: '/',
    tabs: [
      { label: '概況', to: '/', exact: true },
      { label: '目標與政策', to: '/goals' },
      { label: '淨值紀錄', to: '/networth' },
    ],
  },
  {
    id: 'learn',
    label: '學習路線',
    to: '/journey',
    tabs: [
      { label: '行動路線', to: '/journey' },
      { label: '策略手冊', to: '/handbook' },
    ],
  },
  {
    id: 'research',
    label: '研究分析',
    to: '/research/market',
    tabs: [
      { label: '市場', to: '/research/market' },
      { label: '產業', to: '/research/industry' },
      { label: '個股', to: '/research/stocks' },
    ],
  },
  {
    id: 'portfolio',
    label: '投資組合',
    to: '/portfolio',
    tabs: [
      { label: '持股與風控', to: '/portfolio', exact: true },
      { label: '交易日誌', to: '/portfolio/trades' },
      { label: '績效歸因', to: '/portfolio/review' },
    ],
  },
  { id: 'settings', label: '設定', to: '/settings', tabs: [{ label: '設定', to: '/settings' }] },
]

export function tabMatches(tab: NavTab, pathname: string): boolean {
  if (tab.exact) return pathname === tab.to
  return pathname === tab.to || pathname.startsWith(`${tab.to}/`)
}

export function groupOf(pathname: string): NavGroup | undefined {
  return NAV_GROUPS.find((g) => g.tabs.some((t) => tabMatches(t, pathname)))
}

// Old single-page routes, kept as redirects so bookmarks and links still work.
export const LEGACY_REDIRECTS: Record<string, string> = {
  '/fire': '/goals',
  '/strategy': '/goals',
  '/progress': '/networth',
  '/records': '/',
  '/market': '/research/market',
  '/research': '/research/stocks',
  '/trades': '/portfolio/trades',
}
