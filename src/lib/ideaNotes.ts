// Ideas for improving the tool, filed under the system map's three areas
// (architecture.ts). Grouping, ordering and the Markdown export are pure so
// the notes page and its tests share them.
import { ARCH_LAYERS, ARCH_NODES, type ArchNode } from './architecture'
import type { IdeaNote, IdeaNotePriority, IdeaNoteStatus } from './storage/schema'

export const GENERAL_NODE = 'general'
export const GENERAL_TITLE = '整體／跨項目'

export const IDEA_STATUS_LABELS: Record<IdeaNoteStatus, string> = {
  idea: '想法',
  planned: '規劃中',
  done: '已完成',
  dropped: '不做',
}
export const IDEA_STATUSES = Object.keys(IDEA_STATUS_LABELS) as IdeaNoteStatus[]

export const IDEA_PRIORITY_LABELS: Record<IdeaNotePriority, string> = { high: '高', medium: '中', low: '低' }
export const IDEA_PRIORITIES = Object.keys(IDEA_PRIORITY_LABELS) as IdeaNotePriority[]

export function isOpen(note: IdeaNote): boolean {
  return note.status === 'idea' || note.status === 'planned'
}

// Notes whose part was renamed or removed fall back to the general group,
// so they never disappear.
export function nodeOf(note: IdeaNote): string {
  return ARCH_NODES[note.nodeId] ? note.nodeId : GENERAL_NODE
}

export function nodeTitle(nodeId: string): string {
  return ARCH_NODES[nodeId]?.title ?? GENERAL_TITLE
}

const PRIORITY_RANK: Record<IdeaNotePriority, number> = { high: 0, medium: 1, low: 2 }

// Open ideas first, then by priority, then most recently updated.
export function sortNotes(notes: IdeaNote[]): IdeaNote[] {
  return [...notes].sort(
    (a, b) =>
      Number(isOpen(b)) - Number(isOpen(a)) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
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
  const status = n.status === 'planned' || n.status === 'dropped' ? `〔${IDEA_STATUS_LABELS[n.status]}〕` : ''
  const detail = n.detail.trim() ? ` — ${n.detail.trim().replace(/\s*\n\s*/g, ' ')}` : ''
  const where = [n.page ? `記於 ${n.page}` : '', n.createdAt.slice(0, 10)].filter(Boolean).join('，')
  return `- [${n.status === 'done' ? 'x' : ' '}] 〔${IDEA_PRIORITY_LABELS[n.priority]}〕${status}${n.title}${detail}（${where}）`
}

// Markdown for handing the list to someone (or Claude) to implement; only
// parts with notes are listed.
export function notesToMarkdown(notes: IdeaNote[], today: string): string {
  const lines = [`# 精進筆記（${today}，共 ${notes.length} 則）`]
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
