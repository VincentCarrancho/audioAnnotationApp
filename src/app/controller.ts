import type { DomainAction, DomainState, EditorSnapshot, NoteTarget, PlaybackEvent, ProjectRepository, ProjectSession, SaveStatus, TimeRange } from '../contracts'
import { createInitialDomainState, domainReducer } from '../domain'
import { SaveCoordinator } from '../persistence'
import type { NotePanelHandle } from '../features/notes'
import type { TimelineHandle } from '../features/timeline'

export interface AppView {
  state: DomainState
  status: SaveStatus
  dirty: boolean
  error: string | null
  editorError: string | null
  duration: number
  position: number
  playing: boolean
  focusRequest: number
}

type Ports = { editor: () => NotePanelHandle | null; timeline: () => TimelineHandle | null }
const key = (target: NoteTarget) => target.kind === 'project' ? 'project' : `annotation:${target.id}`
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const pauseActions = new Set<DomainAction['type']>(['select-queue-item', 'review-pending', 'done-next', 'skip', 'resume-listening'])
const flushActions = new Set<DomainAction['type']>(['capture-point', 'annotate-selection', 'user-paused', 'playback-ended', 'select-note', 'select-project-note', 'select-queue-item', 'review-pending', 'done-next', 'skip', 'delete-annotation', 'resume-listening'])

/** Owns the current state synchronously; editor I/O and transitions share one serial lane. */
export class AppController {
  readonly sessionKey = crypto.randomUUID()
  view: AppView
  private save: SaveCoordinator
  private revisions = new Map<string, number>()
  private tail: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private alive = true
  private diskDirty = false
  private editorErrorEpoch = 0
  private listeners = new Set<() => void>()

  constructor(readonly session: ProjectSession, repository: ProjectRepository, private ports: Ports, readonly preview = false) {
    this.view = { state: createInitialDomainState(session.project), status: { state: 'saved', revision: 0 }, dirty: false, error: null, editorError: null, duration: 0, position: 0, playing: false, focusRequest: 0 }
    this.save = new SaveCoordinator(repository, session, (status, dirty) => {
      this.diskDirty = dirty
      this.view = { ...this.view, status, dirty: dirty || this.view.editorError !== null }
      this.emit()
    })
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { if (this.alive) this.listeners.forEach(listener => listener()) }
  private patch(patch: Partial<AppView>) { this.view = { ...this.view, ...patch }; this.emit() }
  report = (error: unknown) => { this.patch({ error: message(error) }) }
  reportEditorError = (error: unknown) => {
    if (!this.alive) return
    this.editorErrorEpoch++
    this.patch({ editorError: message(error), dirty: true })
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => { if (!this.alive) throw new Error('Project session is closed'); return operation() })
    this.tail = result.catch(() => undefined)
    return result
  }
  revision(target: NoteTarget | null) { return target ? this.revisions.get(key(target)) ?? 0 : 0 }
  snapshot = (snapshot: EditorSnapshot) => {
    if (!this.alive || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < this.revision(snapshot.target)) return
    const target = snapshot.target
    const existing = target.kind === 'project' ? this.view.state.project.projectNote : this.view.state.project.annotations.find(a => a.id === target.id)?.note
    if (!existing) return
    this.revisions.set(key(target), snapshot.revision)
    // Editor.js adds changing serialization metadata. It is not an edit.
    if (JSON.stringify(existing.blocks) === JSON.stringify(snapshot.document.blocks)) return
    this.apply({ type: 'update-note', target, note: snapshot.document })
  }
  private schedule() {
    if (this.preview || !this.alive) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.manualSave().catch(this.report) }, 900)
  }
  private apply(action: DomainAction) {
    const previous = this.view.state
    const transition = domainReducer(previous, action)
    let focusRequest = this.view.focusRequest
    if (transition.effects.some(effect => effect.type === 'open-note' || effect.type === 'open-project-note')) focusRequest++
    if (transition.effects.some(effect => effect.type === 'seek')) this.pause()
    this.view = { ...this.view, state: transition.state, focusRequest }
    if (previous.project !== transition.state.project) { this.save.update(transition.state.project); this.schedule() }
    for (const effect of transition.effects) if (effect.type === 'seek') this.ports.timeline()?.seek(effect.time)
    this.emit()
  }
  async flush() {
    if (!this.view.state.selectedNote) {
      if (this.view.editorError) throw new Error('The note editor must be recovered before saving.')
      return false
    }
    try {
      const editor = this.ports.editor()
      if (!editor) throw new Error('The note editor is not ready. Please try again.')
      this.snapshot(await editor.flush())
      return true
    } catch (error) { this.reportEditorError(error); throw error }
  }
  private pause() {
    if (this.view.playing) { this.ports.timeline()?.pause('programmatic'); this.patch({ playing: false }) }
  }
  async beforeQueueAction() { this.pause(); await this.flush() }
  private position() {
    const value = this.ports.timeline()?.getPosition() ?? this.view.position
    return Number.isFinite(value) && this.view.duration > 0 ? Math.max(0, Math.min(value, this.view.duration)) : 0
  }
  dispatch(action: DomainAction, expectedReviewId?: string | null): Promise<void> {
    // Stop promptly, even if the editor is slow. Never rely on a suppressed pause event.
    if (pauseActions.has(action.type)) this.pause()
    // Captures during playback must not wait for an editor serialization.
    if ((action.type === 'capture-point' || action.type === 'annotate-selection') && action.playing) { this.apply(action); return Promise.resolve() }
    return this.enqueue(async () => {
      if (flushActions.has(action.type)) await this.flush()
      if (pauseActions.has(action.type)) this.pause()
      if ((action.type === 'done-next' || action.type === 'skip') && expectedReviewId !== undefined && (this.view.state.review.status !== 'active' || this.view.state.review.currentId !== expectedReviewId)) return
      if ((action.type === 'capture-point' || action.type === 'annotate-selection') && this.view.playing) action = { ...action, playing: true }
      // Queue callbacks can be rendered long before they are clicked.
      if (action.type === 'select-queue-item' || action.type === 'review-pending') action = { ...action, position: this.position() }
      this.apply(action)
    })
  }
  capture() {
    if (!(this.view.duration > 0)) return
    const action: DomainAction = { type: 'capture-point', id: crypto.randomUUID(), time: this.position(), duration: this.view.duration, playing: this.view.playing }
    void this.dispatch(action).catch(this.report)
  }
  annotate(range: TimeRange) {
    if (!(this.view.duration > 0)) return
    void this.dispatch({ type: 'annotate-selection', id: crypto.randomUUID(), ...range, position: this.position(), duration: this.view.duration, playing: this.view.playing }).catch(this.report)
  }
  event(event: PlaybackEvent) {
    if (event.type === 'ready') this.patch({ duration: event.duration })
    else if (event.type === 'position') this.patch({ position: event.time })
    else if (event.type === 'playing') this.patch({ playing: true })
    else if (event.type === 'user-paused' || event.type === 'ended') {
      this.patch({ playing: false, position: event.position })
      if (this.view.duration > 0 && Number.isFinite(event.position) && event.position >= 0 && event.position <= this.view.duration) {
        void this.dispatch({ type: event.type === 'ended' ? 'playback-ended' : 'user-paused', position: event.position }).catch(this.report)
      }
    } else if (event.type === 'paused') this.patch({ playing: false, position: event.position })
    else if (event.type === 'annotation-selected') void this.dispatch({ type: 'select-note', id: event.id }).catch(this.report)
    else if (event.type === 'error') this.report(event.message)
  }
  playAnnotation(id: string, loop = false) {
    const annotation = this.view.state.project.annotations.find(item => item.id === id)
    const timeline = this.ports.timeline()
    if (!annotation || !timeline) return
    const anchor = annotation.anchor
    const result = loop && anchor.kind === 'range' ? timeline.loopRange(anchor) : timeline.playFrom(anchor.kind === 'point' ? anchor.time : anchor.start)
    void result.catch(this.report)
  }
  manualSave() {
    return this.enqueue(async () => {
      clearTimeout(this.timer)
      const flushed = await this.flush()
      const errorEpoch = this.editorErrorEpoch
      if (!this.preview) await this.save.saveLatest()
      if (this.editorErrorEpoch !== errorEpoch) throw new Error('A note could not be serialized while saving. Please retry.')
      if (flushed && !this.preview && this.view.editorError) this.patch({ editorError: null, dirty: this.diskDirty })
      this.patch({ error: null })
    })
  }
  async safeToLeave(confirmDiscard: (message: string) => boolean) {
    this.pause()
    try { await this.manualSave(); return true } catch (error) {
      this.report(error)
      return confirmDiscard(`Could not save your latest changes: ${message(error)}\n\nDiscard unsaved changes and leave this project?`)
    }
  }
  dispose() { this.alive = false; clearTimeout(this.timer); this.listeners.clear() }
}

/** M is a capture shortcut only outside text and Editor.js controls. */
export function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .codex-editor, .ce-toolbar, .ce-popover, .inline-toolbar')
}
