import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { IDEA_PRIORITIES, IDEA_PRIORITY_LABELS, isOpen, nodeForPath, nodeOf, nodeTitle, pageLabel, sortNotes } from '../../lib/ideaNotes'
import type { IdeaNoteKind, IdeaNotePriority } from '../../lib/storage/schema'
import { inputClass, labelClass } from '../forms/FormField'
import { KindPicker, NodeOptions, NoteRow } from './NoteRow'
import { useNotesDrawer } from './useNotesDrawer'

type Scope = 'page' | 'node'

const tabClass = (on: boolean) =>
  `rounded px-2 py-0.5 text-xs ${
    on ? 'bg-indigo-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
  }`

// The notes button at the bottom right of every page, and the drawer it
// opens: write an idea for this page and see the ones already written.
export function NotesDrawer() {
  const { pathname } = useLocation()
  const { open, nodeId: requestedNode, openNotes, closeNotes } = useNotesDrawer()
  const notes = useAppStore((s) => s.ideaNotes)
  const pageOpen = notes.filter((n) => n.page === pathname && isOpen(n)).length
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Leaving the page closes it.
  useEffect(() => closeNotes(), [pathname, closeNotes])

  const close = () => {
    closeNotes()
    buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeNotes()
        buttonRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeNotes])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : openNotes())}
        aria-expanded={open}
        aria-label={`筆記${pageOpen > 0 ? `（本頁 ${pageOpen} 則）` : ''}`}
        className="fixed right-4 bottom-4 z-40 flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-indigo-700 print:hidden"
      >
        <span aria-hidden>✎</span>
        <span className="hidden sm:inline">筆記</span>
        {pageOpen > 0 && <span className="rounded-full bg-white/25 px-1.5 text-xs">{pageOpen}</span>}
      </button>
      {/* Mounted for each opening, so the form starts from this page (or the part asked for). */}
      {open && <NotesPanel key={`${pathname}|${requestedNode ?? ''}`} pathname={pathname} requestedNode={requestedNode} onClose={close} />}
    </>
  )
}

function NotesPanel({ pathname, requestedNode, onClose }: { pathname: string; requestedNode: string | null; onClose: () => void }) {
  const notes = useAppStore((s) => s.ideaNotes)
  const addIdeaNote = useAppStore((s) => s.addIdeaNote)
  const pageNode = nodeForPath(pathname)
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    kind: 'improve' as IdeaNoteKind,
    nodeId: requestedNode ?? pageNode,
    title: '',
    detail: '',
    priority: 'medium' as IdeaNotePriority,
  })
  const [scope, setScope] = useState<Scope>(requestedNode && requestedNode !== pageNode ? 'node' : 'page')
  const [showAll, setShowAll] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => inputRef.current?.focus(), [])

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    addIdeaNote({
      kind: form.kind,
      nodeId: form.nodeId,
      title: form.title.trim(),
      detail: form.detail.trim(),
      priority: form.priority,
      page: pathname,
    })
    setForm({ ...form, title: '', detail: '' })
    setMessage('已記下')
    inputRef.current?.focus()
  }

  const listNode = scope === 'node' ? form.nodeId : pageNode
  const list = sortNotes(
    notes.filter((n) => (scope === 'page' ? n.page === pathname : nodeOf(n) === listNode && n.page !== pathname) && (showAll || isOpen(n))),
  )

  return (
    <div className="fixed inset-0 z-50 print:hidden">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 flex max-h-[85svh] flex-col rounded-t-xl bg-white shadow-xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none dark:bg-gray-800"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-gray-100">
              筆記・{pageLabel(pathname)}
            </h2>
            <Link to="/notes" className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              看全部筆記與匯出
            </Link>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉筆記"
            className="rounded-md px-2 py-1 text-lg leading-none text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <form onSubmit={add} className="space-y-3">
            <KindPicker value={form.kind} onChange={(kind) => setForm({ ...form, kind })} />
            <label className="block">
              <span className={labelClass}>標題</span>
              <input
                ref={inputRef}
                className={inputClass}
                value={form.title}
                placeholder={form.kind === 'improve' ? '這一頁可以怎麼更好？' : '想到什麼、學到什麼？'}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="block">
              <span className={labelClass}>說明（選填）</span>
              <textarea className={inputClass} rows={2} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
            </label>
            <div className={`grid gap-3 ${form.kind === 'improve' ? 'grid-cols-[1fr_6rem]' : 'grid-cols-1'}`}>
              <label className="block">
                <span className={labelClass}>環節</span>
                <select className={inputClass} value={form.nodeId} onChange={(e) => setForm({ ...form, nodeId: e.target.value })}>
                  <NodeOptions />
                </select>
              </label>
              {/* Insights are not worked through, so they take no priority. */}
              {form.kind === 'improve' && (
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
              )}
            </div>
            <div className="flex items-center gap-3">
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

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <div className="flex gap-1" role="group" aria-label="範圍">
              <button type="button" aria-pressed={scope === 'page'} onClick={() => setScope('page')} className={tabClass(scope === 'page')}>
                本頁
              </button>
              <button type="button" aria-pressed={scope === 'node'} onClick={() => setScope('node')} className={tabClass(scope === 'node')}>
                {nodeTitle(listNode)}的其他頁
              </button>
            </div>
            <label className="ml-auto flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              含已完成與不做
            </label>
          </div>
          {list.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{scope === 'page' ? '這一頁還沒有筆記。' : '其他頁還沒有這個環節的筆記。'}</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-700">
              {list.map((n) => (
                <NoteRow key={n.id} note={n} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
