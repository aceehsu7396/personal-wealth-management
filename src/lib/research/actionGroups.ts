import type { SignalAction } from './signals'

// Research cards and the watchlist grouped by what to do next, so a long
// list opens on the names that need attention: act first, then wait, and
// the rest folded away.

export type ActionGroupKey = 'act' | 'enter' | 'wait' | 'hold' | 'avoid' | 'unchecked' | 'nocard' | 'exited'

export const ACTION_GROUP_LABELS: Record<ActionGroupKey, string> = {
  act: '要處理（減碼、出清、複查）',
  enter: '可進場（買進、加碼）',
  wait: '等待',
  hold: '續抱',
  avoid: '不投資或偏貴',
  unchecked: '未體檢',
  nocard: '尚無研究卡',
  exited: '已出場',
}

const ORDER: ActionGroupKey[] = ['act', 'enter', 'wait', 'hold', 'avoid', 'unchecked', 'nocard', 'exited']
// Shown open in a long list.
const URGENT: ActionGroupKey[] = ['act', 'enter', 'wait']
// Up to this many names, every group starts open.
export const OPEN_ALL_MAX = 10

export function actionGroupOf(action: SignalAction | null, exited = false): ActionGroupKey {
  if (exited) return 'exited'
  if (action === null) return 'unchecked'
  if (action === 'trim' || action === 'exit' || action === 'review') return 'act'
  if (action === 'buy' || action === 'add') return 'enter'
  return action
}

export interface ItemGroup<T> {
  key: ActionGroupKey
  label: string
  items: T[]
}

// Groups in a fixed order, empty ones left out; items keep their order.
export function groupItems<T>(items: T[], groupOf: (item: T) => ActionGroupKey): ItemGroup<T>[] {
  return ORDER.map((key) => ({ key, label: ACTION_GROUP_LABELS[key], items: items.filter((i) => groupOf(i) === key) })).filter((g) => g.items.length > 0)
}

export function openByDefault(key: ActionGroupKey, total: number, searching: boolean): boolean {
  return searching || total <= OPEN_ALL_MAX || URGENT.includes(key)
}

// Matches a search against any of the given texts, ignoring case.
export function matchesQuery(query: string, texts: (string | undefined)[]): boolean {
  const q = query.trim().toUpperCase()
  return q === '' || texts.some((t) => (t ?? '').toUpperCase().includes(q))
}
