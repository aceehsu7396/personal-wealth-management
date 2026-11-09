import { createContext, useContext } from 'react'

// Lets any page open the notes drawer, optionally for a given part of the
// system map (the notes page's "＋新增" buttons use it).

export interface NotesDrawerState {
  open: boolean
  // Part to preselect; null means the current page's part.
  nodeId: string | null
}

export interface NotesDrawerValue extends NotesDrawerState {
  openNotes: (nodeId?: string) => void
  closeNotes: () => void
}

export const NotesDrawerContext = createContext<NotesDrawerValue | null>(null)

export function useNotesDrawer(): NotesDrawerValue {
  const value = useContext(NotesDrawerContext)
  if (!value) throw new Error('useNotesDrawer needs NotesDrawerProvider')
  return value
}
