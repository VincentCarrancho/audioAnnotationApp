// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { EditorSnapshot, ProjectData, ProjectRepository, ProjectSession } from '../contracts'
import type { NotePanelHandle } from '../features/notes'
import type { TimelineHandle } from '../features/timeline'
import { AppController, isEditingTarget } from './controller'

const project = (): ProjectData => ({ version: 1, id: 'p', name: 'Project', recording: { relativePath: 'audio.wav' }, annotations: [], projectNote: { blocks: [] }, pendingAnnotationIds: [] })
const snapshot = (id: string, text: string, revision = 1): EditorSnapshot => ({ target: { kind: 'annotation', id }, revision, document: { blocks: [{ type: 'paragraph', data: { text } }] } })
function setup() {
  const session: ProjectSession = { directory: '/project', recordingUrl: 'asset://audio', project: project() }
  const repository: ProjectRepository = { create: vi.fn(), open: vi.fn(), save: vi.fn().mockResolvedValue(undefined) }
  let position = 0
  const timeline: TimelineHandle = { getPosition: () => position, seek: vi.fn((time: number) => { position = time }), pause: vi.fn(), play: vi.fn(), playFrom: vi.fn(), loopRange: vi.fn(), clearLoop: vi.fn() }
  const editor: NotePanelHandle = { flush: vi.fn(), focus: vi.fn() }
  const app = new AppController(session, repository, { timeline: () => timeline, editor: () => editor })
  app.event({ type: 'ready', duration: 20 })
  return { app, editor, timeline, repository, at: (value: number) => { position = value } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('integrated project controller', () => {
  it('captures immediately during a slow editor flush and enters review at pause without changing capture order', async () => {
    const { app, editor, at, timeline } = setup()
    at(1); app.capture(); await tick()
    const first = app.view.state.project.annotations[0].id
    const slow = deferred<EditorSnapshot>()
    vi.mocked(editor.flush).mockReturnValueOnce(slow.promise)
    app.event({ type: 'playing' }); at(5)
    const changing = app.dispatch({ type: 'select-project-note' })
    await Promise.resolve()
    app.capture(); at(7); app.capture()
    expect(app.view.state.project.annotations.map(a => a.anchor)).toEqual([{ kind: 'point', time: 1 }, { kind: 'point', time: 5 }, { kind: 'point', time: 7 }])
    expect(app.view.playing).toBe(true)
    slow.resolve(snapshot(first, 'first note'))
    await changing
    vi.mocked(editor.flush).mockResolvedValue({ target: { kind: 'project' }, revision: 0, document: { blocks: [] } })
    app.event({ type: 'user-paused', position: 8 }); await tick()
    expect(app.view.state.review).toMatchObject({ status: 'active', currentId: first })
    // The paused capture already started review, so replay/pause must not switch it.
    expect(timeline.seek).not.toHaveBeenCalled()
    expect(app.view.state.project.annotations[0].note.blocks[0].data.text).toBe('first note')
    app.dispose()
  })
  it('pause starts review, replay pause keeps current, explicit queue and done pause playback and stay paused', async () => {
    const { app, timeline, editor, at } = setup()
    app.event({ type: 'playing' }); at(3); app.capture(); at(2); app.capture()
    const [first, second] = app.view.state.project.annotations.map(a => a.id)
    app.event({ type: 'user-paused', position: 9 }); await tick()
    expect(app.view.state.review).toMatchObject({ status: 'active', currentId: first, resumePosition: 9 })
    expect(timeline.seek).toHaveBeenCalledWith(3)
    vi.mocked(editor.flush).mockImplementation(async () => snapshot(app.view.state.selectedNote?.kind === 'annotation' ? app.view.state.selectedNote.id : '', ''))
    app.event({ type: 'playing' }); app.event({ type: 'user-paused', position: 4 }); await tick()
    expect(app.view.state.review).toMatchObject({ currentId: first })
    app.event({ type: 'playing' })
    await app.dispatch({ type: 'done-next' }, first)
    expect(timeline.pause).toHaveBeenCalledWith('programmatic')
    expect(app.view.playing).toBe(false)
    expect(app.view.state.review).toMatchObject({ currentId: second })
    expect(timeline.seek).toHaveBeenLastCalledWith(2)
    await app.dispatch({ type: 'done-next' }, first) // stale double click
    expect(app.view.state.project.pendingAnnotationIds).toEqual([second])
    app.event({ type: 'playing' }); app.event({ type: 'paused', position: 2 })
    expect(app.view.playing).toBe(false)
    expect(app.view.state.review).toMatchObject({ currentId: second })
    app.dispose()
  })
  it('ordinary selection does not seek, save flushes the selected note without completing review', async () => {
    const { app, editor, repository, timeline, at } = setup()
    app.event({ type: 'playing' }); at(4); app.capture(); at(6); app.capture()
    const [first, second] = app.view.state.project.annotations.map(a => a.id)
    app.event({ type: 'user-paused', position: 10 }); await tick()
    vi.mocked(editor.flush).mockResolvedValueOnce(snapshot(first, 'latest first'))
    vi.mocked(timeline.seek).mockClear()
    await app.dispatch({ type: 'select-note', id: second })
    expect(timeline.seek).not.toHaveBeenCalled()
    expect(app.view.state.review).toMatchObject({ currentId: first })
    vi.mocked(editor.flush).mockResolvedValueOnce(snapshot(second, 'latest second'))
    await app.manualSave()
    expect(app.view.state.project.pendingAnnotationIds).toEqual([first, second])
    expect(app.view.state.project.annotations.map(a => a.note.blocks[0].data.text)).toEqual(['latest first', 'latest second'])
    expect(repository.save).toHaveBeenCalledWith(expect.anything(), app.view.state.project, expect.any(Number))
    app.dispose()
  })
  it('rejects stale note snapshots, avoids serialization metadata save loops, and recovers after failed save', async () => {
    const { app, editor, repository, at } = setup()
    at(1); app.capture(); await tick()
    const id = app.view.state.project.annotations[0].id
    app.snapshot(snapshot(id, 'new', 3)); app.snapshot(snapshot(id, 'old', 2))
    const withMetadata = { ...snapshot(id, 'new', 3), document: { ...snapshot(id, 'new').document, time: 999 } }
    vi.mocked(editor.flush).mockResolvedValue(withMetadata)
    vi.mocked(repository.save).mockRejectedValueOnce(new Error('disk full'))
    await expect(app.manualSave()).rejects.toThrow('disk full')
    expect(app.view.status.state).toBe('failed')
    expect(app.view.dirty).toBe(true)
    expect(app.view.state.project.annotations[0].note.blocks[0].data.text).toBe('new')
    expect(await app.safeToLeave(() => false)).toBe(true) // retry succeeds
    const calls = vi.mocked(repository.save).mock.calls.length
    await app.manualSave()
    expect(repository.save).toHaveBeenCalledTimes(calls)
    expect(app.view.dirty).toBe(false)
    app.dispose()
  })
  it('blocks leaving on a failed flush unless the user explicitly discards', async () => {
    const { app, editor } = setup()
    app.capture(); await tick()
    vi.mocked(editor.flush).mockRejectedValue(new Error('editor unavailable'))
    expect(await app.safeToLeave(() => false)).toBe(false)
    expect(app.view.error).toContain('editor unavailable')
    expect(await app.safeToLeave(() => true)).toBe(true)
    app.dispose()
  })
  it('marks an otherwise saved project unsaved on editor serialization failure until a flush and durable save succeed', async () => {
    const { app, editor, repository } = setup()
    await app.dispatch({ type: 'select-project-note' })
    expect(app.view.dirty).toBe(false)
    // An editor onChange can fail before any snapshot reaches the controller.
    app.reportEditorError(new Error('serialization failed'))
    expect(app.view.editorError).toContain('serialization failed')
    expect(app.view.dirty).toBe(true)
    vi.mocked(editor.flush).mockRejectedValue(new Error('serialization failed'))
    await expect(app.manualSave()).rejects.toThrow('serialization failed')
    expect(app.view.dirty).toBe(true)
    expect(app.view.editorError).toContain('serialization failed')
    expect(await app.safeToLeave(() => false)).toBe(false)
    // An unrelated audio failure must not replace the editor-unsaved warning.
    app.report(new Error('audio unavailable'))
    expect(app.view.editorError).toContain('serialization failed')
    vi.mocked(editor.flush).mockResolvedValue({ target: { kind: 'project' }, revision: 1, document: { blocks: [{ type: 'paragraph', data: { text: 'retained' } }] } })
    vi.mocked(repository.save).mockRejectedValueOnce(new Error('disk full'))
    await expect(app.manualSave()).rejects.toThrow('disk full')
    expect(app.view.editorError).toContain('serialization failed')
    expect(app.view.dirty).toBe(true)
    expect(await app.safeToLeave(() => false)).toBe(true)
    expect(app.view.editorError).toBeNull()
    expect(app.view.dirty).toBe(false)
    expect(app.view.state.project.projectNote.blocks[0].data.text).toBe('retained')
    app.dispose()
  })
  it('marks a flush rejection unsaved even when no editor error callback was sent', async () => {
    const { app, editor } = setup()
    await app.dispatch({ type: 'select-project-note' })
    vi.mocked(editor.flush).mockRejectedValue(new Error('flush failed'))
    await expect(app.manualSave()).rejects.toThrow('flush failed')
    expect(app.view.editorError).toContain('flush failed')
    expect(app.view.dirty).toBe(true)
    app.dispose()
  })
  it('does not clear a newer editor error when an earlier save finishes', async () => {
    const { app, editor, repository } = setup()
    await app.dispatch({ type: 'select-project-note' })
    app.reportEditorError(new Error('first failure'))
    vi.mocked(editor.flush).mockResolvedValue({ target: { kind: 'project' }, revision: 1, document: { blocks: [{ type: 'paragraph', data: { text: 'in flight' } }] } })
    const write = deferred<void>()
    vi.mocked(repository.save).mockReturnValueOnce(write.promise)
    const saving = app.manualSave()
    await tick()
    app.reportEditorError(new Error('newer failure'))
    write.resolve()
    await expect(saving).rejects.toThrow('while saving')
    expect(app.view.editorError).toContain('newer failure')
    expect(app.view.dirty).toBe(true)
    app.dispose()
  })
  it('debounces autosave and writes changes arriving during an in-flight save', async () => {
    vi.useFakeTimers()
    try {
      const { app, repository, at } = setup()
      const firstWrite = deferred<void>()
      vi.mocked(repository.save).mockReturnValueOnce(firstWrite.promise).mockResolvedValue(undefined)
      app.event({ type: 'playing' }); at(1); app.capture()
      await vi.advanceTimersByTimeAsync(900)
      expect(repository.save).toHaveBeenCalledTimes(1)
      at(2); app.capture()
      firstWrite.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(repository.save).toHaveBeenCalledTimes(2)
      expect(vi.mocked(repository.save).mock.calls[1][1].annotations).toHaveLength(2)
      expect(app.view.dirty).toBe(false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(repository.save).toHaveBeenCalledTimes(2)
      app.dispose()
    } finally { vi.useRealTimers() }
  })
  it('retains failed autosave data and retries the newest revision after another edit', async () => {
    vi.useFakeTimers()
    try {
      const { app, repository, at } = setup()
      vi.mocked(repository.save).mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
      app.event({ type: 'playing' }); at(1); app.capture()
      await vi.advanceTimersByTimeAsync(900)
      expect(app.view.status.state).toBe('failed')
      expect(app.view.dirty).toBe(true)
      at(2); app.capture()
      await vi.advanceTimersByTimeAsync(900)
      expect(app.view.status.state).toBe('saved')
      expect(app.view.dirty).toBe(false)
      expect(vi.mocked(repository.save).mock.calls[1][1].annotations).toHaveLength(2)
      app.dispose()
    } finally { vi.useRealTimers() }
  })
  it('does not accept a late snapshot from a closed project session', () => {
    const { app } = setup()
    app.event({ type: 'playing' }); app.capture()
    const id = app.view.state.project.annotations[0].id
    app.dispose()
    app.snapshot(snapshot(id, 'late', 5))
    expect(app.view.state.project.annotations[0].note.blocks).toEqual([])
  })
  it('guards M in input, editable regions and editor controls', () => {
    document.body.innerHTML = '<input><div contenteditable="true"><span></span></div><div class="codex-editor"><button></button></div><button id="outside"></button>'
    expect(isEditingTarget(document.querySelector('input'))).toBe(true)
    expect(isEditingTarget(document.querySelector('[contenteditable] span'))).toBe(true)
    expect(isEditingTarget(document.querySelector('.codex-editor button'))).toBe(true)
    expect(isEditingTarget(document.querySelector('#outside'))).toBe(false)
  })
})
