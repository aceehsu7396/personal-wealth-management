// Notes filed under the system map's three areas (architecture.ts): ideas
// for improving the tool, tracked to done, and insights or thoughts. Grouping, ordering and the Markdown export are pure so
// the notes page and its tests share them.
import { ARCH_LAYERS, ARCH_NODES, PAGE_NODES, type ArchNode } from './architecture'
import { NAV_GROUPS, tabMatches } from '../components/layout/navigation'
import type { IdeaNote, IdeaNoteKind, IdeaNotePriority, IdeaNoteStatus } from './storage/schema'

export const GENERAL_NODE = 'general'
export const GENERAL_TITLE = '整體／跨項目'

export const IDEA_KIND_LABELS: Record<IdeaNoteKind, string> = { improve: '功能精進', insight: '心得想法' }
export const IDEA_KINDS = Object.keys(IDEA_KIND_LABELS) as IdeaNoteKind[]

export const IDEA_STATUS_LABELS: Record<IdeaNoteStatus, string> = {
  idea: '想法',
  planned: '規劃中',
  done: '已完成',
  dropped: '不做',
}
export const IDEA_STATUSES = Object.keys(IDEA_STATUS_LABELS) as IdeaNoteStatus[]

export const IDEA_PRIORITY_LABELS: Record<IdeaNotePriority, string> = { high: '高', medium: '中', low: '低' }
export const IDEA_PRIORITIES = Object.keys(IDEA_PRIORITY_LABELS) as IdeaNotePriority[]

// Insights have nothing to finish, so they always count as open.
export function isOpen(note: IdeaNote): boolean {
  return note.kind === 'insight' || note.status === 'idea' || note.status === 'planned'
}

// Notes whose part was renamed or removed fall back to the general group,
// so they never disappear.
export function nodeOf(note: IdeaNote): string {
  return ARCH_NODES[note.nodeId] ? note.nodeId : GENERAL_NODE
}

export function nodeTitle(nodeId: string): string {
  return ARCH_NODES[nodeId]?.title ?? GENERAL_TITLE
}

// The part a page belongs to: working pages by the system map, handbook
// chapters by the part that cites them, everything else general.
export function nodeForPath(pathname: string): string {
  if (PAGE_NODES[pathname]) return PAGE_NODES[pathname]
  const slug = decodeURIComponent(pathname.match(/^\/handbook\/(.+)$/)?.[1] ?? '')
  const cited = slug ? Object.values(ARCH_NODES).find((n) => n.handbook.slug === slug) : undefined
  return cited?.id ?? GENERAL_NODE
}

// "研究分析・選股", "手冊 05": a readable name for where a note was written.
export function pageLabel(pathname: string): string {
  const slug = decodeURIComponent(pathname.match(/^\/handbook\/(.+)$/)?.[1] ?? '')
  if (slug) return `手冊 ${slug.replace(/^附錄/, '附錄 ')}`
  // The most specific tab wins (/portfolio/trades over /portfolio).
  for (const g of NAV_GROUPS) {
    const tab = g.tabs.filter((t) => tabMatches(t, pathname)).sort((a, b) => b.to.length - a.to.length)[0]
    if (tab) return g.utility || g.tabs.length === 1 ? tab.label : `${g.label}・${tab.label}`
  }
  return pathname
}

const PRIORITY_RANK: Record<IdeaNotePriority, number> = { high: 0, medium: 1, low: 2 }

// Open improvements by priority, then insights, then finished improvements;
// most recently updated first within each.
const GROUP_RANK = (n: IdeaNote) => (n.kind === 'insight' ? 1 : isOpen(n) ? 0 : 2)
export function sortNotes(notes: IdeaNote[]): IdeaNote[] {
  return [...notes].sort(
    (a, b) =>
      GROUP_RANK(a) - GROUP_RANK(b) ||
      (GROUP_RANK(a) === 0 ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] : 0) ||
      b.updatedAt.localeCompare(a.updatedAt),
  )
}

export interface NodeNotes {
  id: string
  node: ArchNode | null
  notes: IdeaNote[]
}

export interface AreaNotes {
  title: string
  summary: string
  nodes: NodeNotes[]
}

// The general group first, then each area and its parts in map order.
export function groupByArea(notes: IdeaNote[]): AreaNotes[] {
  const byNode = new Map<string, IdeaNote[]>()
  for (const n of notes) {
    const id = nodeOf(n)
    byNode.set(id, [...(byNode.get(id) ?? []), n])
  }
  const entry = (id: string): NodeNotes => ({ id, node: ARCH_NODES[id] ?? null, notes: sortNotes(byNode.get(id) ?? []) })
  return [
    { title: GENERAL_TITLE, summary: '不屬於單一環節的想法', nodes: [entry(GENERAL_NODE)] },
    ...ARCH_LAYERS.map((layer) => ({ title: layer.title, summary: layer.summary, nodes: layer.nodes.map(entry) })),
  ]
}

function noteLine(n: IdeaNote): string {
  const detail = n.detail.trim() ? ` — ${n.detail.trim().replace(/\s*\n\s*/g, ' ')}` : ''
  const where = [n.page ? `記於 ${pageLabel(n.page)}（${n.page}）` : '', n.createdAt.slice(0, 10)].filter(Boolean).join('，')
  if (n.kind === 'insight') return `- 〔心得〕${n.title}${detail}（${where}）`
  const status = n.status === 'planned' || n.status === 'dropped' ? `〔${IDEA_STATUS_LABELS[n.status]}〕` : ''
  return `- [${n.status === 'done' ? 'x' : ' '}] 〔${IDEA_PRIORITY_LABELS[n.priority]}〕${status}${n.title}${detail}（${where}）`
}

// Markdown for reviewing the notes or handing improvements to someone (or
// Claude) to implement; only parts with notes are listed.
export function notesToMarkdown(notes: IdeaNote[], today: string): string {
  const lines = [`# 筆記（${today}，共 ${notes.length} 則）`]
  for (const area of groupByArea(notes)) {
    const nodes = area.nodes.filter((n) => n.notes.length > 0)
    if (nodes.length === 0) continue
    lines.push('', `## ${area.title}`)
    for (const { id, node, notes: list } of nodes) {
      const refs = node ? `（頁面 ${node.page.to}；手冊 ${node.handbook.label}）` : ''
      lines.push('', `### ${nodeTitle(id)}${refs}`, ...list.map(noteLine))
    }
  }
  return `${lines.join('\n')}\n`
}
