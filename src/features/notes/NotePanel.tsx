import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { DomainAction, DomainState, EditorSnapshot, NoteTarget } from '../../contracts'
import { createEditorAdapter } from './editorAdapter'
import { annotationLabel, formatAnchor } from './labels'
import './notes.css'

export interface NotePanelHandle {
  /** Await this before saving, project switches, close, or actions that change notes. */
  flush(): Promise<EditorSnapshot>
  focus(): void
}

export interface NotePanelProps {
  state: DomainState
  /** Current per-target revision from composition's revision registry. */
  revision: number
  onSnapshot(snapshot: EditorSnapshot): void
  /** Composition handles domain actions and effects. */
  onAction(action: DomainAction): void | Promise<void>
  onPlayAnnotation(id: string): void
  onLoopAnnotation(id: string): void
  /** Change only for explicit open/review requests that should put focus in the editor. */
  focusRequest?: number
  onError?(error: unknown): void
}

function targetKey(target: NoteTarget | null): string {
  return target?.kind === 'project' ? 'project' : target ? `annotation:${target.id}` : ''
}

export const NotePanel = forwardRef<NotePanelHandle, NotePanelProps>(function NotePanel(props, ref) {
  const holder = useRef<HTMLDivElement>(null)
  const adapter = useRef<ReturnType<typeof createEditorAdapter> | null>(null)
  const teardown = useRef<Promise<void>>(Promise.resolve())
  const latest = useRef(props)
  latest.current = props
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [opened, setOpened] = useState<{ target: string; focusRequest?: number } | null>(null)
  const focusedRequest = useRef<number | undefined>(undefined)
  const deliveredFocus = useRef<number | undefined>(undefined)
  const target = props.state.selectedNote
  const selected = target?.kind === 'annotation' ? props.state.project.annotations.find(a => a.id === target.id) : undefined
  const targetId = targetKey(target)

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : String(error))
    latest.current.onError?.(error)
  }

  useImperativeHandle(ref, () => ({
    flush: async () => {
      if (!adapter.current) throw new Error('Editor is not ready')
      try {
        const snapshot = await adapter.current.flush()
        setError(null)
        return snapshot
      } catch (error) { report(error); throw error }
    },
    focus: () => {
      const target = latest.current.state.selectedNote
      if (target) adapter.current?.focus(target)
    },
  }), [])

  useEffect(() => {
    let cancelled = false
    let instance: ReturnType<typeof createEditorAdapter> | null = null
    let unsubscribe = () => {}
    setReady(false)
    // StrictMode can immediately remount effects; don't overlap two editors in one holder.
    void teardown.current.then(() => {
      if (cancelled || !holder.current) return
      instance = createEditorAdapter(holder.current, { onError: report })
      adapter.current = instance
      unsubscribe = instance.subscribe(snapshot => latest.current.onSnapshot(snapshot))
      setReady(true)
    }).catch(report)
    return () => {
      cancelled = true
      // The caller must await flush before unmount; keep the subscriber for the final flush.
      adapter.current = null
      if (instance) {
        teardown.current = instance.destroy().finally(unsubscribe)
        void teardown.current.catch(error => latest.current.onError?.(error))
      }
    }
  }, [])

  useEffect(() => {
    const instance = adapter.current
    const current = latest.current
    const noteTarget = current.state.selectedNote
    if (!ready || !instance || !noteTarget) return
    const annotation = noteTarget.kind === 'annotation'
      ? current.state.project.annotations.find(a => a.id === noteTarget.id) : undefined
    const document = noteTarget.kind === 'project' ? current.state.project.projectNote : annotation?.note
    if (!document) return
    const shouldFocus = current.focusRequest !== undefined && current.focusRequest !== focusedRequest.current
    if (shouldFocus) focusedRequest.current = current.focusRequest
    let cancelled = false
    void instance.open(noteTarget, document, current.revision).then(() => {
      if (cancelled) return
      setError(null)
      setOpened({ target: targetKey(noteTarget), focusRequest: shouldFocus ? current.focusRequest : undefined })
    }).catch(error => { if (!cancelled) report(error) })
    return () => { cancelled = true }
  }, [ready, targetId, props.focusRequest])

  useLayoutEffect(() => {
    const request = opened?.focusRequest
    if (request === undefined || request !== props.focusRequest || request === deliveredFocus.current || opened?.target !== targetId) return
    if (!holder.current || holder.current.hidden || !adapter.current) return
    deliveredFocus.current = request
    if (target) adapter.current.focus(target)
  }, [opened, targetId, props.focusRequest])

  async function act(action: DomainAction) {
    setBusy(true)
    try {
      if (target && adapter.current) await adapter.current.flush()
      await latest.current.onAction(action)
      setError(null)
    } catch (error) { report(error) } finally { setBusy(false) }
  }

  const annotations = [...props.state.project.annotations].sort((a, b) => {
    const start = (item: typeof a) => item.anchor.kind === 'point' ? item.anchor.time : item.anchor.start
    return start(a) - start(b)
  })

  return <section className="wn-notes" aria-label="Notes">
    <div className="wn-notes-layout">
      <nav aria-label="Annotation navigation" className="wn-note-nav">
        <button type="button" aria-current={target?.kind === 'project' ? 'page' : undefined} disabled={busy}
          onClick={() => void act({ type: 'select-project-note' })}>Project note</button>
        <h3>Annotations</h3>
        {annotations.length === 0 && <p>No annotations yet.</p>}
        <ol>{annotations.map(annotation => <li key={annotation.id}>
          <button type="button" aria-current={selected?.id === annotation.id ? 'page' : undefined} disabled={busy}
            onClick={() => void act({ type: 'select-note', id: annotation.id })}>
            <span className="wn-time">{formatAnchor(annotation.anchor)}</span>
            <span>{annotationLabel(annotation, props.state.project.pendingAnnotationIds.includes(annotation.id))}</span>
          </button>
        </li>)}</ol>
      </nav>
      <div className="wn-note-content">
        <div className="wn-note-heading">
          <h2>{target?.kind === 'project' ? 'Project note' : selected ? `Annotation · ${formatAnchor(selected.anchor)}` : 'Notes'}</h2>
          {selected && <div className="wn-note-actions">
            <button type="button" onClick={() => props.onPlayAnnotation(selected.id)}>Play from annotation</button>
            {selected.anchor.kind === 'range' && <button type="button" onClick={() => props.onLoopAnnotation(selected.id)}>Loop annotation</button>}
            <button type="button" disabled={busy} onClick={() => void act({ type: 'delete-annotation', id: selected.id })}>Delete annotation</button>
          </div>}
        </div>
        {error && <p role="alert" className="wn-note-error">Could not edit note: {error}</p>}
        {!target && <p>Select an annotation or the project note to write.</p>}
        {target && opened?.target !== targetId && !error && <p>Opening note…</p>}
        <div className="wn-editor" hidden={!target || opened?.target !== targetId} role="group" aria-label="Note editor" ref={holder} />
      </div>
    </div>
  </section>
})
