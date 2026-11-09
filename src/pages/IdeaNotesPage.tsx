import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import {
  GENERAL_TITLE,
  IDEA_KINDS,
  IDEA_KIND_LABELS,
  IDEA_STATUSES,
  IDEA_STATUS_LABELS,
  groupByArea,
  isOpen,
  nodeOf,
  notesToMarkdown,
} from '../lib/ideaNotes'
import type { IdeaNoteKind, IdeaNoteStatus } from '../lib/storage/schema'
import { todayIsoDate } from '../lib/market/twse'
import { inputClass, labelClass } from '../components/forms/FormField'
import { NoteRow, NodeOptions } from '../components/notes/NoteRow'
import { useNotesDrawer } from '../components/notes/useNotesDrawer'

const cardClass = 'mt-6 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800'
const buttonClass =
  'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'

type StatusFilter = 'open' | 'all' | IdeaNoteStatus
type KindFilter = 'all' | IdeaNoteKind

export function IdeaNotesPage() {
  const notes = useAppStore((s) => s.ideaNotes)
  const { openNotes } = useNotesDrawer()
  const [search, setSearch] = useSearchParams()
  const nodeFilter = search.get('node') ?? ''
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')

  const q = query.trim().toLowerCase()
  const visible = notes.filter(
    (n) =>
      (kindFilter === 'all' || n.kind === kindFilter) &&
      // A single status only applies to improvements; insights have none.
      (statusFilter === 'all' || (statusFilter === 'open' ? isOpen(n) : n.kind === 'improve' && n.status === statusFilter)) &&
      (!nodeFilter || nodeOf(n) === nodeFilter) &&
      (!q || `${n.title} ${n.detail}`.toLowerCase().includes(q)),
  )
  const areas = groupByArea(visible)
  const improvements = notes.filter((x) => x.kind === 'improve')
  const counts = IDEA_STATUSES.map((s) => `${IDEA_STATUS_LABELS[s]} ${improvements.filter((x) => x.status === s).length}`)
  const insights = notes.length - improvements.length

  const markdown = () => notesToMarkdown(visible, todayIsoDate())
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown())
      setMessage(`已複製 ${visible.length} 則為 Markdown`)
    } catch {
      setMessage('瀏覽器不允許複製，請改用下載')
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `筆記-${todayIsoDate()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }
  const setNode = (id: string) => {
    const next = new URLSearchParams(search)
    if (id) next.set('node', id)
    else next.delete('node')
    setSearch(next, { replace: true })
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">筆記</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        記下工具可以精進的地方，也記下使用時的心得與想法，依系統地圖的三大項目與環節分類。每一頁右下角的「✎ 筆記」都能隨時記一筆；在這裡可以篩選與複製成 Markdown，回顧心得或把精進項目交給 Claude 實作。
      </p>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        功能精進：{counts.join('・')}｜心得想法 {insights}
      </p>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => openNotes(nodeFilter || undefined)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          ✎ 記一筆
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={labelClass}>類型</span>
          <select className={inputClass} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)}>
            <option value="all">全部</option>
            {IDEA_KINDS.map((k) => (
              <option key={k} value={k}>
                {IDEA_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>狀態</span>
          <select
            className={inputClass}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="open">未完成的精進＋心得</option>
            <option value="all">全部</option>
            {IDEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {IDEA_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>環節</span>
          <select className={inputClass} value={nodeFilter} onChange={(e) => setNode(e.target.value)}>
            <option value="">全部環節</option>
            <NodeOptions />
          </select>
        </label>
        <label className="block min-w-40 flex-1">
          <span className={labelClass}>搜尋</span>
          <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="標題或說明" />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={copy} disabled={visible.length === 0} className={`${buttonClass} disabled:opacity-50`}>
            複製 Markdown
          </button>
          <button type="button" onClick={download} disabled={visible.length === 0} className={`${buttonClass} disabled:opacity-50`}>
            下載 .md
          </button>
        </div>
      </div>
      {message && (
        <p role="status" className="mt-2 text-sm text-indigo-700 dark:text-indigo-400">
          {message}
        </p>
      )}

      {areas.map((area) => {
        const nodes = area.nodes.filter((n) => !nodeFilter || n.id === nodeFilter)
        if (nodes.length === 0) return null
        return (
          <section key={area.title} className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{area.title}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{area.summary}</p>
            <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-700">
              {nodes.map(({ id, node, notes: list }) => (
                <div key={id} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {node?.title ?? GENERAL_TITLE}
                      <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">（{list.length}）</span>
                    </h3>
                    {node && (
                      <>
                        <Link to={node.page.to} className={linkClass}>
                          前往頁面
                        </Link>
                        <Link to={`/handbook/${node.handbook.slug}`} className={linkClass}>
                          手冊 {node.handbook.label}
                        </Link>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => openNotes(id)}
                      aria-label={`在「${node?.title ?? GENERAL_TITLE}」新增想法`}
                      className={`${linkClass} ml-auto`}
                    >
                      ＋新增
                    </button>
                  </div>
                  {node && list.length > 0 && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{node.what}</p>}
                  {list.length > 0 && (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                      {list.map((n) => (
                        <NoteRow key={n.id} note={n} />
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
