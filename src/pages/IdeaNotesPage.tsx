import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../lib/storage/appStore'
import { ARCH_LAYERS, ARCH_NODES } from '../lib/architecture'
import {
  GENERAL_NODE,
  GENERAL_TITLE,
  IDEA_PRIORITIES,
  IDEA_PRIORITY_LABELS,
  IDEA_STATUSES,
  IDEA_STATUS_LABELS,
  groupByArea,
  isOpen,
  nodeOf,
  notesToMarkdown,
} from '../lib/ideaNotes'
import type { IdeaNote, IdeaNotePriority, IdeaNoteStatus } from '../lib/storage/schema'
import { todayIsoDate } from '../lib/market/twse'
import { inputClass, labelClass } from '../components/forms/FormField'

const cardClass = 'mt-6 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800'
const buttonClass =
  'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
const linkClass = 'text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400'
const smallSelect =
  'rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'

type StatusFilter = 'open' | 'all' | IdeaNoteStatus

const STATUS_TONE: Record<IdeaNoteStatus, string> = {
  idea: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  planned: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  done: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  dropped: 'bg-gray-100 text-gray-500 line-through dark:bg-gray-800 dark:text-gray-500',
}

// Node choices grouped by area, the general group first.
function NodeOptions() {
  return (
    <>
      <option value={GENERAL_NODE}>{GENERAL_TITLE}</option>
      {ARCH_LAYERS.map((layer) => (
        <optgroup key={layer.title} label={layer.title}>
          {layer.nodes.map((id) => (
            <option key={id} value={id}>
              {ARCH_NODES[id].title}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

function NoteRow({ note }: { note: IdeaNote }) {
  const updateIdeaNote = useAppStore((s) => s.updateIdeaNote)
  const removeIdeaNote = useAppStore((s) => s.removeIdeaNote)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(note.title)
  const [detail, setDetail] = useState(note.detail)
  const [nodeId, setNodeId] = useState(nodeOf(note))
  const [pendingDelete, setPendingDelete] = useState(false)

  const save = () => {
    if (!title.trim()) return
    updateIdeaNote(note.id, { title: title.trim(), detail: detail.trim(), nodeId })
    setEditing(false)
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TONE[note.status]}`}>
          {IDEA_STATUS_LABELS[note.status]}
        </span>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className={`min-w-0 flex-1 text-left text-sm ${
            isOpen(note) ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <span className="font-medium">{note.title}</span>
          {!editing && note.detail && <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{note.detail}</span>}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label="狀態"
            className={smallSelect}
            value={note.status}
            onChange={(e) => updateIdeaNote(note.id, { status: e.target.value as IdeaNoteStatus })}
          >
            {IDEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {IDEA_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="優先度"
            className={smallSelect}
            value={note.priority}
            onChange={(e) => updateIdeaNote(note.id, { priority: e.target.value as IdeaNotePriority })}
          >
            {IDEA_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                優先 {IDEA_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
        {note.createdAt.slice(0, 10)} 記
        {note.page && (
          <>
            {' ・ '}
            <Link to={note.page} className="hover:underline">
              {note.page}
            </Link>
          </>
        )}
        {note.doneAt && `・${note.doneAt.slice(0, 10)} 完成`}
      </p>
      {editing && (
        <div className="mt-3 space-y-3 rounded-md bg-gray-50 p-3 dark:bg-gray-900/40">
          <label className="block">
            <span className={labelClass}>標題</span>
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block">
            <span className={labelClass}>說明</span>
            <textarea className={inputClass} rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
          <label className="block">
            <span className={labelClass}>環節</span>
            <select className={inputClass} value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
              <NodeOptions />
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              儲存
            </button>
            <button type="button" onClick={() => setEditing(false)} className={buttonClass}>
              取消
            </button>
            {pendingDelete ? (
              <button
                type="button"
                onClick={() => removeIdeaNote(note.id)}
                className="ml-auto rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                確定刪除
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPendingDelete(true)}
                className="ml-auto text-sm font-medium text-red-600 hover:underline dark:text-red-400"
              >
                刪除
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export function IdeaNotesPage() {
  const notes = useAppStore((s) => s.ideaNotes)
  const addIdeaNote = useAppStore((s) => s.addIdeaNote)
  const [search, setSearch] = useSearchParams()
  const nodeFilter = search.get('node') ?? ''
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [query, setQuery] = useState('')
  const [form, setForm] = useState({ nodeId: nodeFilter || GENERAL_NODE, title: '', detail: '', priority: 'medium' as IdeaNotePriority })
  const [message, setMessage] = useState('')

  const q = query.trim().toLowerCase()
  const visible = notes.filter(
    (n) =>
      (statusFilter === 'all' || (statusFilter === 'open' ? isOpen(n) : n.status === statusFilter)) &&
      (!nodeFilter || nodeOf(n) === nodeFilter) &&
      (!q || `${n.title} ${n.detail}`.toLowerCase().includes(q)),
  )
  const areas = groupByArea(visible)
  const counts = IDEA_STATUSES.map((s) => ({ s, n: notes.filter((x) => x.status === s).length }))

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    addIdeaNote({ nodeId: form.nodeId, title: form.title.trim(), detail: form.detail.trim(), priority: form.priority })
    setForm({ ...form, title: '', detail: '' })
    setMessage('已記下')
  }

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
    a.download = `精進筆記-${todayIsoDate()}.md`
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
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">精進筆記</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        記下工具在功能面上可以精進的想法，依系統地圖的三大項目與環節分類。各頁上方「在架構中的位置」也能直接記一筆；想實作時，複製成 Markdown 交給 Claude。
      </p>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {counts.map(({ s, n }) => `${IDEA_STATUS_LABELS[s]} ${n}`).join('・')}
      </p>

      <form onSubmit={add} className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">記一筆想法</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
          <label className="block">
            <span className={labelClass}>環節</span>
            <select className={inputClass} value={form.nodeId} onChange={(e) => setForm({ ...form, nodeId: e.target.value })}>
              <NodeOptions />
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>優先度</span>
            <select
              className={inputClass}
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as IdeaNotePriority })}
            >
              {IDEA_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {IDEA_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className={labelClass}>標題</span>
          <input
            className={inputClass}
            value={form.title}
            placeholder="例：觀察名單可以依產業分組"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label className="mt-3 block">
          <span className={labelClass}>說明（選填）</span>
          <textarea className={inputClass} rows={2} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!form.title.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            新增
          </button>
          {message && (
            <span role="status" className="text-sm text-indigo-700 dark:text-indigo-400">
              {message}
            </span>
          )}
        </div>
      </form>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={labelClass}>狀態</span>
          <select
            className={inputClass}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="open">未完成（想法＋規劃中）</option>
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
                      onClick={() => {
                        setForm({ ...form, nodeId: id })
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
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
