import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ARCH_NODES, PAGE_NODES, edgesInto, edgesOutOf } from '../lib/architecture'
import { useAppStore } from '../lib/storage/appStore'
import { isOpen } from '../lib/ideaNotes'

const STORAGE_KEY = 'pfm:pageContextOpen'

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

// One line above each working page: where it sits in the system map, what
// feeds it, what it feeds, and why this step comes here. Ideas for improving
// the page can be noted from here (精進筆記).
export function PageContext() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(readOpen)
  const notes = useAppStore((s) => s.ideaNotes)
  const addIdeaNote = useAppStore((s) => s.addIdeaNote)
  // The page these belong to, so they reset when the page changes.
  const [notingOn, setNotingOn] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savedOn, setSavedOn] = useState<string | null>(null)
  const id = PAGE_NODES[pathname]
  if (!id) return null
  const noting = notingOn === pathname
  const saved = savedOn === pathname
  const openIdeas = notes.filter((n) => n.nodeId === id && isOpen(n)).length
  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    addIdeaNote({ nodeId: id, title: draft.trim(), page: pathname })
    setDraft('')
    setNotingOn(null)
    setSavedOn(pathname)
  }
  const node = ARCH_NODES[id]
  const titles = (ids: string[]) => [...new Set(ids)].map((x) => ARCH_NODES[x].title).join('、') || '—'
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(STORAGE_KEY, open ? '0' : '1')
    } catch {
      // Remembering the choice is optional.
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pt-4">
      <div className="rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-gray-700 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-gray-300">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-indigo-800 dark:text-indigo-300">在架構中的位置</span>
          <span>
            {titles(edgesInto(id).map((e) => e.from))} → <strong className="text-gray-900 dark:text-gray-100">{node.title}</strong> →{' '}
            {titles(edgesOutOf(id).map((e) => e.to))}
          </span>
          <span className="ml-auto flex items-center gap-3">
            {openIdeas > 0 && (
              <Link to={`/notes?node=${id}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
                想法 {openIdeas}
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                setNotingOn(noting ? null : pathname)
                setSavedOn(null)
              }}
              className="font-medium text-indigo-700 hover:underline dark:text-indigo-400"
            >
              ＋記想法
            </button>
            <button type="button" onClick={toggle} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              {open ? '收合' : '為什麼？'}
            </button>
          </span>
        </div>
        {noting && (
          <form onSubmit={save} className="mt-2 flex gap-2">
            <input
              autoFocus
              aria-label={`記下「${node.title}」可以精進的想法`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`「${node.title}」可以怎麼更好？按 Enter 記下`}
              className="min-w-0 flex-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs text-gray-900 focus:border-indigo-600 focus:outline-none dark:border-indigo-800 dark:bg-gray-800 dark:text-gray-100"
            />
            <button type="submit" disabled={!draft.trim()} className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              記下
            </button>
          </form>
        )}
        {saved && (
          <p role="status" className="mt-1">
            已記下。
            <Link to={`/notes?node=${id}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
              看精進筆記
            </Link>
          </p>
        )}
        {open && (
          <div className="mt-1 space-y-0.5">
            <p>
              <span className="font-semibold">為什麼：</span>
              {node.why}
            </p>
            <p>
              <Link to="/handbook/00" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
                看系統地圖
              </Link>
              {' ・ '}
              <Link to={`/handbook/${node.handbook.slug}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
                手冊 {node.handbook.label}
              </Link>
              {' ・ '}
              <Link to="/handbook/附錄C" className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">
                參數地圖
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
