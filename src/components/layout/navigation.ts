// Top-level navigation: the three areas of the site, then the notes, the
// handbook (with the action roadmap) and settings at the right of the top bar.

export interface NavTab {
  label: string
  to: string
  // Exact tabs match only their own path (e.g. "/portfolio");
  // others also match sub-paths (e.g. "/handbook/03").
  exact?: boolean
}

export interface NavGroup {
  id: 'research' | 'strategy' | 'portfolio' | 'notes' | 'handbook' | 'settings'
  label: string
  to: string
  tabs: NavTab[]
  // Shown as a small link at the right of the top bar.
  utility?: boolean
}

// Opening the site lands on the first area.
export const HOME_PATH = '/research/market'

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'research',
    label: '研究分析',
    to: '/research/market',
    tabs: [
      { label: '市場', to: '/research/market' },
      { label: '選股', to: '/research/screener' },
      { label: '研究卡', to: '/research/stocks' },
    ],
  },
  {
    id: 'strategy',
    label: '模擬交易',
    to: '/sim/strategies',
    tabs: [
      { label: '策略卡', to: '/sim/strategies' },
      { label: '回測', to: '/sim/backtest' },
      { label: '虛擬帳戶', to: '/sim/paper' },
    ],
  },
  {
    id: 'portfolio',
    label: '投資持有與檢討回顧',
    to: '/today',
    tabs: [
      { label: '今日', to: '/today' },
      { label: '目標與政策', to: '/goals' },
      { label: '持股與風控', to: '/portfolio', exact: true },
      { label: '交易日誌', to: '/portfolio/trades' },
      { label: '績效歸因', to: '/portfolio/review' },
    ],
  },
  { id: 'notes', label: '筆記', to: '/notes', tabs: [{ label: '筆記', to: '/notes' }], utility: true },
  {
    id: 'handbook',
    label: '手冊',
    to: '/handbook',
    tabs: [
      { label: '手冊', to: '/handbook' },
      { label: '行動路線', to: '/journey' },
    ],
    utility: true,
  },
  { id: 'settings', label: '⚙ 設定', to: '/settings', tabs: [{ label: '設定', to: '/settings' }], utility: true },
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
  '/progress': '/today',
  '/networth': '/today',
  '/records': '/today',
  '/market': '/research/market',
  '/research': '/research/stocks',
  '/trades': '/portfolio/trades',
  '/sim/screener': '/research/screener',
  '/research/industry': '/research/stocks',
}
