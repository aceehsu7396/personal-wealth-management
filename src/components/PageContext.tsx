import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ARCH_NODES, PAGE_NODES, edgesInto, edgesOutOf } from '../lib/architecture'

const STORAGE_KEY = 'pfm:pageContextOpen'

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

// One line above each working page: where it sits in the system map, what
// feeds it, what it feeds, and why this step comes here.
export function PageContext() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(readOpen)
  const id = PAGE_NODES[pathname]
  if (!id) return null
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
          <button type="button" onClick={toggle} className="ml-auto font-medium text-indigo-700 hover:underline dark:text-indigo-400">
            {open ? '收合' : '為什麼？'}
          </button>
        </div>
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
