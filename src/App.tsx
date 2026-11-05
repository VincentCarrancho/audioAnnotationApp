import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import type { DomainAction, ProjectData, ProjectRepository, ProjectSession } from './contracts'
import { Timeline, type TimelineHandle } from './features/timeline'
import { NotePanel, type NotePanelHandle } from './features/notes'
import { QueuePanel } from './features/queue'
import { chooseProjectFolder, chooseProjectParent, chooseSourceWav, NativeProjectRepository, protectNativeClose } from './persistence'
import { AppController, isEditingTarget } from './app/controller'

const repository = new NativeProjectRepository()
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
// Freeze the current editor until a leave operation either installs the next
// project or is cancelled. Otherwise a keystroke during the disk write can
// arrive after the final flush.
function freezeWorkspace() {
  const workspace = document.querySelector<HTMLElement>('main.workspace')
  if (!workspace || workspace.inert) return () => {}
  workspace.inert = true
  return () => { workspace.inert = false }
}
const previewProject: ProjectData = {
  version: 1, id: 'fixture-preview', name: 'Listening notes · preview', recording: { relativePath: 'smoke.wav' },
  annotations: [
    { id: 'fixture-one', anchor: { kind: 'point', time: 0.4 }, note: { blocks: [{ id: 'fixture-block', type: 'paragraph', data: { text: 'A place to start listening.' } }] } },
    { id: 'fixture-two', anchor: { kind: 'range', start: 0.8, end: 1.5 }, note: { blocks: [] } },
  ], projectNote: { blocks: [] }, pendingAnnotationIds: ['fixture-one', 'fixture-two'],
}
const previewRepository: ProjectRepository = {
  create: async () => { throw new Error('Preview cannot create projects') },
  open: async () => { throw new Error('Preview cannot open projects') },
  save: async () => { throw new Error('Preview is not persistent') },
}

export default function App() {
  const native = isTauri()
  const editor = useRef<NotePanelHandle>(null)
  const timeline = useRef<TimelineHandle>(null)
  const active = useRef<AppController | null>(null)
  const [controller, setController] = useState<AppController | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [guardStatus, setGuardStatus] = useState<'pending' | 'ready' | 'failed'>(native ? 'pending' : 'ready')
  const [guardError, setGuardError] = useState<string | null>(null)
  const [guardAttempt, setGuardAttempt] = useState(0)
  const guardReady = useRef(!native)
  const [source, setSource] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  function install(session: ProjectSession, repo: ProjectRepository, preview = false) {
    if (native && !guardReady.current) throw new Error('Close protection is not ready. Retry protection before opening a project.')
    const next = new AppController(session, repo, { editor: () => editor.current, timeline: () => timeline.current }, preview)
    active.current?.dispose()
    active.current = next
    setController(next)
    setCreating(false); setSource(null); setParent(null); setName(''); setError(null)
  }
  async function safeToLeave() { return !active.current || active.current.safeToLeave(text => window.confirm(text)) }
  async function run(operation: () => Promise<void>) {
    if (busyRef.current || (native && !guardReady.current)) return
    busyRef.current = true; setBusy(true); setError(null)
    try { await operation() } catch (reason) { setError(errorMessage(reason)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function openProject() {
    await run(async () => {
      const folder = await chooseProjectFolder()
      if (!folder) return
      const thaw = freezeWorkspace()
      try {
        if (!await safeToLeave()) return
        if (!guardReady.current) throw new Error('Close protection is not ready. Retry protection before opening a project.')
        install(await repository.open(folder), repository)
      } finally { thaw() }
    })
  }
  async function createProject() {
    if (!source || !parent || !name.trim()) return
    await run(async () => {
      const thaw = freezeWorkspace()
      try {
        if (!await safeToLeave()) return
        if (!guardReady.current) throw new Error('Close protection is not ready. Retry protection before creating a project.')
        install(await repository.create({ sourceWavPath: source, parentDirectory: parent, name: name.trim() }), repository)
      } finally { thaw() }
    })
  }
  function openPreview() {
    const session: ProjectSession = { directory: '', project: structuredClone(previewProject), recordingUrl: '/smoke.wav' }
    install(session, previewRepository, true)
  }
  useEffect(() => {
    if (!native) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    let thaw = () => {}
    guardReady.current = false
    setGuardStatus('pending')
    setGuardError(null)
    void protectNativeClose(async () => {
      if (busyRef.current) return false
      busyRef.current = true; setBusy(true)
      thaw = freezeWorkspace()
      try {
        const allowed = await safeToLeave()
        if (!allowed) { thaw(); busyRef.current = false; setBusy(false) }
        return allowed
      } catch (reason) { thaw(); busyRef.current = false; setBusy(false); throw reason }
    }, reason => { if (!cancelled) { thaw(); busyRef.current = false; setBusy(false); setError(errorMessage(reason)) } }).then(stop => {
      if (cancelled) { stop(); return }
      unlisten = stop
      guardReady.current = true
      setGuardStatus('ready')
    }).catch(reason => {
      if (cancelled) return
      guardReady.current = false
      setGuardError(errorMessage(reason))
      setGuardStatus('failed')
    })
    return () => { cancelled = true; guardReady.current = false; unlisten?.() }
  }, [native, guardAttempt])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const current = active.current
      if (!current || (native && !guardReady.current) || event.defaultPrevented || event.isComposing || document.querySelector<HTMLElement>('main.workspace')?.inert) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); void current.manualSave().catch(current.report); return
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && !event.repeat && event.key.toLowerCase() === 'z' && !isEditingTarget(event.target) && current.view.state.undoDelete) {
        event.preventDefault(); void current.dispatch({ type: 'undo-delete' }).catch(current.report); return
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat && event.key.toLowerCase() === 'm' && !isEditingTarget(event.target)) {
        event.preventDefault(); current.capture()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [native])

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true">≋</span><span>wav<span>Notes</span></span></div>
      <div className="header-actions">
        {controller && <span className="project-name">{controller.session.project.name}</span>}
        {native && <><button className="quiet" disabled={busy || guardStatus !== 'ready'} onClick={() => { setCreating(true); setError(null) }}>New project</button><button className="quiet" disabled={busy || guardStatus !== 'ready'} onClick={() => void openProject()}>Open project</button></>}
        {controller && !controller.preview && <button disabled={busy || (native && guardStatus !== 'ready')} onClick={() => void controller.manualSave().catch(controller.report)}>Save <kbd>⌘ S</kbd></button>}
      </div>
    </header>
    {native && guardStatus === 'pending' && <div className="guard-notice" role="status">Preparing close protection… Projects are locked until protection is ready.</div>}
    {native && guardStatus === 'failed' && <div className="shell-error" role="alert">Could not protect unsaved changes: {guardError}. Projects are locked. Retry protection or restart the app. <button onClick={() => { guardReady.current = false; setGuardError(null); setGuardStatus('pending'); setGuardAttempt(attempt => attempt + 1) }}>Retry protection</button></div>}
    {error && <div className="shell-error" role="alert">{error} <button className="quiet" onClick={() => setError(null)}>Dismiss</button></div>}
    {creating && native && <section className="create-card" aria-label="Create project" inert={guardStatus !== 'ready' || undefined}>
      <div className="section-heading"><div><p className="eyebrow">A new listening notebook</p><h2>Create a project</h2><p>Your WAV is copied into its own project folder; the original stays untouched.</p></div><button className="quiet" onClick={() => setCreating(false)}>Cancel</button></div>
      <div className="create-fields">
        <div><label>1. Recording</label><button disabled={busy} onClick={() => void run(async () => { const value = await chooseSourceWav(); if (value) { setSource(value); if (!name) setName(value.split(/[\\/]/).pop()?.replace(/\.wav$/i, '') ?? '') } })}>Choose WAV…</button><span className="path">{source || 'No recording selected'}</span></div>
        <div><label htmlFor="project-name">2. Project name</label><input id="project-name" value={name} onChange={event => setName(event.target.value)} placeholder="Name your project" /></div>
        <div><label>3. Location</label><button disabled={busy} onClick={() => void run(async () => { const value = await chooseProjectParent(); if (value) setParent(value) })}>Choose location…</button><span className="path">{parent || 'No location selected'}</span></div>
      </div>
      <button className="primary" disabled={busy || !source || !parent || !name.trim()} onClick={() => void createProject()}>{busy ? 'Creating…' : 'Create project'}</button>
    </section>}
    {controller ? <div inert={native && guardStatus !== 'ready' || undefined}><ProjectWorkspace key={controller.sessionKey} controller={controller} editor={editor} timeline={timeline} /></div> : !creating && <main className="welcome">
      <div className="welcome-art" aria-hidden="true"><span>◦</span><div>▂▃▆▃▇▅▂▆▃▅▂</div></div>
      <p className="eyebrow">A little more room to listen</p>
      <h1>Listen closely.<br /><em>Keep what you notice.</em></h1>
      <p>Make notes at moments and passages in a recording, without breaking your concentration.</p>
      {native ? <div className="welcome-actions"><button className="primary" disabled={busy || guardStatus !== 'ready'} onClick={() => setCreating(true)}>New project</button><button onClick={() => void openProject()} disabled={busy || guardStatus !== 'ready'}>Open project folder</button></div> : <><p className="native-notice">Projects require the macOS desktop app. Browser preview is a disposable fixture and cannot save or open projects.</p><button onClick={openPreview}>Open nonpersistent preview</button></>}
      <div className="welcome-hint">WAV recordings · Your notes stay in your project folder</div>
    </main>}
  </div>
}

function ProjectWorkspace({ controller, editor, timeline }: { controller: AppController; editor: React.RefObject<NotePanelHandle | null>; timeline: React.RefObject<TimelineHandle | null> }) {
  const view = useSyncExternalStore(controller.subscribe, () => controller.view)
  const state = view.state
  const expected = state.review.status === 'active' ? state.review.currentId : null
  const act = (action: DomainAction) => controller.dispatch(action, expected)
  const status = view.editorError ? `Save failed · note not serialized: ${view.editorError}` : controller.preview ? 'Preview · changes are not saved' : view.status.state === 'failed' ? `Save failed · ${view.status.message}` : view.status.state === 'saving' ? 'Saving…' : view.dirty ? 'Unsaved changes' : 'Saved'
  return <main className="workspace">
    <div className="workspace-heading"><div><p className="eyebrow">Listening notebook</p><h1>{state.project.name}</h1></div><div className={`save-status ${view.editorError || view.status.state === 'failed' ? 'failed' : ''}`} role="status"><span />{status}</div></div>
    {view.error && <div className="workspace-error" role="alert">{view.error}</div>}
    {controller.preview && <div className="preview-banner">Fixture preview only · edits disappear when you leave. Create and open real projects in the macOS app.</div>}
    <div className="timeline-heading"><div><h2>Recording</h2><p>Listen, select a passage, or drop a marker as you go.</p></div><button className="primary marker-button" disabled={!view.duration} onClick={() => controller.capture()}>+ Add marker <kbd>M</kbd></button></div>
    <Timeline ref={timeline} recordingUrl={controller.session.recordingUrl} annotations={state.project.annotations} selectedAnnotationId={state.selectedNote?.kind === 'annotation' ? state.selectedNote.id : null} onEvent={event => controller.event(event)} onAnnotateSelection={range => controller.annotate(range)} onAnchorChange={(id, anchor, duration) => void controller.dispatch({ type: 'update-anchor', id, anchor, duration }).catch(controller.report)} />
    <p className="keyboard-hint"><kbd>M</kbd> captures without interrupting playback. Pause to review your markers.</p>
    <div className="workspace-lower">
      <NotePanel ref={editor} state={state} revision={controller.revision(state.selectedNote)} onSnapshot={controller.snapshot} onAction={act} focusRequest={view.focusRequest} onError={controller.reportEditorError} onPlayAnnotation={id => controller.playAnnotation(id)} onLoopAnnotation={id => controller.playAnnotation(id, true)} />
      <QueuePanel state={state} position={view.position} beforeAction={() => controller.beforeQueueAction()} onAction={act} onError={controller.report} />
    </div>
  </main>
}
