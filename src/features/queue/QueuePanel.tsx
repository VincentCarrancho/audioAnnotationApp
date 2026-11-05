import { useState } from 'react'
import type { DomainAction, DomainState, Seconds } from '../../contracts'
import { annotationLabel, formatAnchor } from '../notes/labels'
import './queue.css'

export interface QueuePanelProps {
  state: DomainState
  /** Current playhead, used only when explicitly starting a review. */
  position: Seconds
  /** Must flush the current editor, if any, before resolving. */
  beforeAction(): Promise<void>
  onAction(action: DomainAction): void | Promise<void>
  onError?(error: unknown): void
}

export function QueuePanel({ state, position, beforeAction, onAction, onError }: QueuePanelProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = state.project.pendingAnnotationIds
    .map(id => state.project.annotations.find(annotation => annotation.id === id))
    .filter((annotation): annotation is NonNullable<typeof annotation> => !!annotation)
  const active = state.review.status === 'active' ? state.review.currentId : null
  const viewingActive = active !== null && state.selectedNote?.kind === 'annotation' && state.selectedNote.id === active

  async function act(action: DomainAction) {
    setBusy(true)
    try {
      await beforeAction()
      await onAction(action)
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      onError?.(error)
    } finally { setBusy(false) }
  }

  return <section className="wn-queue" aria-label="Focus queue">
    <div className="wn-queue-heading"><h2>Focus queue</h2><span>{pending.length} pending</span></div>
    {error && <p role="alert" className="wn-queue-error">Could not change review: {error}</p>}
    {pending.length === 0 ? <p>No pending annotations.</p> : <ol className="wn-queue-list">
      {pending.map(annotation => <li key={annotation.id}>
        <button type="button" disabled={busy} aria-current={active === annotation.id ? 'step' : undefined}
          onClick={() => void act({ type: 'select-queue-item', id: annotation.id, position })}>
          <span className="wn-queue-time">{formatAnchor(annotation.anchor)}</span>
          <span>{annotationLabel(annotation, true)}</span>
          {active === annotation.id && <span className="wn-queue-current">In review</span>}
        </button>
      </li>)}
    </ol>}
    {state.review.status === 'inactive' && pending.length > 0 &&
      <button type="button" disabled={busy} onClick={() => void act({ type: 'review-pending', position })}>
        Continue writing ({pending.length})
      </button>}
    {state.review.status === 'active' && (viewingActive
      ? <div className="wn-queue-actions" aria-label="Review actions">
          <button type="button" disabled={busy} onClick={() => void act({ type: 'done-next' })}>Done → Next</button>
          <button type="button" disabled={busy} onClick={() => void act({ type: 'skip' })}>Skip for now</button>
        </div>
      : <p>The review item is not currently open. Select it in the queue to continue review.</p>)}
    {state.review.status === 'finished' && <div className="wn-queue-result">
      <p>Review pass finished · {pending.length} pending.</p>
      <div className="wn-queue-actions">
        {pending.length > 0 && <button type="button" disabled={busy} onClick={() => void act({ type: 'review-pending', position })}>Review pending</button>}
        <button type="button" disabled={busy} onClick={() => void act({ type: 'resume-listening' })}>Resume listening</button>
      </div>
    </div>}
    {state.undoDelete && <button type="button" disabled={busy} onClick={() => void act({ type: 'undo-delete' })}>Undo delete</button>}
  </section>
}
