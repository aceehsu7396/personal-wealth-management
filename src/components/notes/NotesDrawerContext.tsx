import { useCallback, useMemo, useState } from 'react'
import { NotesDrawerContext, type NotesDrawerState } from './useNotesDrawer'

export function NotesDrawerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NotesDrawerState>({ open: false, nodeId: null })
  const openNotes = useCallback((nodeId?: string) => setState({ open: true, nodeId: nodeId ?? null }), [])
  const closeNotes = useCallback(() => setState({ open: false, nodeId: null }), [])
  const value = useMemo(() => ({ ...state, openNotes, closeNotes }), [state, openNotes, closeNotes])
  return <NotesDrawerContext.Provider value={value}>{children}</NotesDrawerContext.Provider>
}
