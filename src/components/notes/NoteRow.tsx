import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../../lib/storage/appStore'
import { ARCH_LAYERS, ARCH_NODES } from '../../lib/architecture'
import {
  GENERAL_NODE,
  GENERAL_TITLE,
  IDEA_PRIORITIES,
  IDEA_PRIORITY_LABELS,
  IDEA_STATUSES,
  IDEA_STATUS_LABELS,
  isOpen,
  nodeOf,
  pageLabel,
} from '../../lib/ideaNotes'
import type { IdeaNote, IdeaNotePriority, IdeaNoteStatus } from '../../lib/storage/schema'
import { inputClass, labelClass } from '../forms/FormField'

// Pieces shared by the notes page and the notes drawer.

const buttonClass =
  'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
const smallSelect =
  'rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'

const STATUS_TONE: Record<IdeaNoteStatus, string> = {
  idea: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  planned: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  done: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  dropped: 'bg-gray-100 text-gray-500 line-through dark:bg-gray-800 dark:text-gray-500',
}

// Node choices grouped by area, the general group first.
export function NodeOptions() {
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

export function NoteRow({ note }: { note: IdeaNote }) {
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
              {pageLabel(note.page)}
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

