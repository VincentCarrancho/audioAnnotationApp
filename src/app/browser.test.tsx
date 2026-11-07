// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forwardRef, StrictMode, useImperativeHandle } from 'react'
import App from '../App'
import type { DomainAction, DomainState } from '../contracts'

const native = vi.hoisted(() => ({ enabled: false, create: vi.fn(), open: vi.fn(), save: vi.fn(), seek: vi.fn(), play: vi.fn(), pause: vi.fn(), position: 1, guard: vi.fn(), chooseAudio: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.enabled, convertFileSrc: (path: string) => path, invoke: vi.fn() }))
vi.mock('../persistence', async importOriginal => {
  const original = await importOriginal<typeof import('../persistence')>()
  return { ...original, NativeProjectRepository: class { create = native.create; open = native.open; save = native.save },
    chooseSourceAudio: native.chooseAudio, chooseProjectParent: async () => '/notes',
    chooseProjectFolder: async () => '/notes/demo', protectNativeClose: native.guard }
})
vi.mock('../features/timeline', () => ({ Timeline: forwardRef(function MockTimeline(props: { onEvent(event: unknown): void; annotations: unknown[] }, ref) {
  useImperativeHandle(ref, () => ({ getPosition: () => native.position, seek: native.seek, play: () => { native.play(); props.onEvent({ type: 'playing' }); return Promise.resolve() }, pause: (reason: string) => { native.pause(reason); props.onEvent({ type: reason === 'user' ? 'user-paused' : 'paused', position: native.position }) } }))
  return <><span data-testid="count">{props.annotations.length}</span><button onClick={() => props.onEvent({ type: 'ready', duration: 2 })}>Load recording</button></>
}) }))
vi.mock('../features/notes', () => ({ NotePanel: forwardRef(function MockPanel(props: { state: DomainState; onAction(action: DomainAction): void; onError(error: unknown): void }, _ref) {
  return <><div contentEditable suppressContentEditableWarning role="textbox">editor</div>
    <button onClick={() => props.onAction({ type: 'delete-annotation', id: 'fixture-one' })}>Delete fixture</button>
    <button onClick={() => props.onError(new Error('serialization failed'))}>Simulate editor error</button>
    <div data-testid="project">{JSON.stringify(props.state.project)}</div></>
}) }))
vi.mock('../features/queue', () => ({ QueuePanel: () => <div>queue</div> }))
afterEach(() => { cleanup(); native.enabled = false; vi.clearAllMocks() })
beforeEach(() => { native.position = 1; native.guard.mockReset().mockResolvedValue(() => {}); native.chooseAudio.mockReset().mockResolvedValue('/original/demo.wav') })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('browser fallback', () => {
  it('routes unmodified workspace transport keys through the global listener, guarding repeats and unloaded audio', async () => {
    render(<App />)
    expect(fireEvent.keyDown(document.body, { key: ' ', cancelable: true })).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Open nonpersistent preview/ }))
    expect(fireEvent.keyDown(document.body, { key: ' ', cancelable: true })).toBe(true)
    expect(native.play).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Load recording' }))
    expect(fireEvent.keyDown(document.body, { key: ' ', cancelable: true })).toBe(false)
    expect(native.play).toHaveBeenCalledTimes(1)
    expect(fireEvent.keyDown(document.body, { key: ' ', repeat: true, cancelable: true })).toBe(false)
    expect(native.pause).not.toHaveBeenCalled()
    native.position = 1.5
    expect(fireEvent.keyDown(document.body, { key: 'ArrowLeft', repeat: true, cancelable: true })).toBe(false)
    expect(native.seek).toHaveBeenLastCalledWith(0)
    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight', cancelable: true })).toBe(false)
    expect(native.seek).toHaveBeenLastCalledWith(2)
    expect(native.pause).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(document.body, { key: ' ', cancelable: true })).toBe(false)
    expect(native.pause).toHaveBeenCalledWith('user')
    await waitFor(() => expect(native.seek).toHaveBeenLastCalledWith(0.4))
  })
  it('leaves editing, widgets, button activation, modifiers and inert workspaces alone', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Open nonpersistent preview/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Load recording' }))
    const workspace = document.querySelector<HTMLElement>('main.workspace')!
    const elements = document.createElement('div')
    elements.innerHTML = '<input type="range"><select><option>one</option></select><div contenteditable="true"><span>text</span></div><div class="ce-popover"><button>menu</button></div><div class="ce-inline-toolbar"><span>toolbar</span></div><button>Done</button><div role="slider" tabindex="0"></div>'
    workspace.append(elements)
    for (const target of elements.querySelectorAll('input, select, span, button, [role="slider"]')) {
      expect(fireEvent.keyDown(target, { key: ' ', cancelable: true })).toBe(true)
      expect(fireEvent.keyDown(target, { key: 'ArrowRight', cancelable: true })).toBe(true)
    }
    const done = elements.querySelectorAll('button')[1]
    const activate = vi.fn()
    done.addEventListener('click', activate)
    done.focus()
    expect(fireEvent.keyDown(done, { key: ' ', cancelable: true })).toBe(true)
    fireEvent.keyUp(done, { key: ' ' })
    fireEvent.click(done) // jsdom does not synthesize the browser's native activation
    expect(activate).toHaveBeenCalledTimes(1)
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
      expect(fireEvent.keyDown(document.body, { key: ' ', cancelable: true, ...modifier })).toBe(true)
      expect(fireEvent.keyDown(document.body, { key: 'ArrowRight', cancelable: true, ...modifier })).toBe(true)
    }
    expect(fireEvent.keyDown(document.body, { key: 's', metaKey: true, cancelable: true })).toBe(false)
    expect(fireEvent.keyDown(document.body, { key: ' ', isComposing: true, cancelable: true })).toBe(true)
    const prevented = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    prevented.preventDefault()
    document.body.dispatchEvent(prevented)
    workspace.inert = true
    expect(fireEvent.keyDown(document.body, { key: ' ', cancelable: true })).toBe(true)
    expect(native.play).not.toHaveBeenCalled()
    expect(native.seek).not.toHaveBeenCalled()
    workspace.inert = false
    elements.remove()
  })
  it('requires native projects and opens only a clearly labelled fixture', () => {
    render(<App />)
    expect(screen.getByText('Notate').parentElement?.textContent).toBe('aNotate')
    expect(screen.getByText(/Projects require the macOS desktop app/)).toBeTruthy()
    expect(screen.queryByText('Open project')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Open nonpersistent preview/ }))
    expect(screen.getByText(/Fixture preview only/)).toBeTruthy()
    expect(screen.getByText(/Preview · changes are not saved/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
  })
  it('allows the capture shortcut outside the editor but not while typing inside it', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Open nonpersistent preview/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Load recording' }))
    expect(screen.getByTestId('count').textContent).toBe('2')
    // Shift focus into an editor: the M must remain text, not a marker.
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'm' })
    expect(screen.getByTestId('count').textContent).toBe('2')
    // Capture outside remains available and is handled at the window level.
    fireEvent.keyDown(document.body, { key: 'm' })
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'))
  })
  it('restores a deleted annotation with its note and pending state using keyboard undo, without stealing editor undo or seeking', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Open nonpersistent preview/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete fixture' }))
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))
    expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'z', metaKey: true, cancelable: true })).toBe(true)
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(fireEvent.keyDown(document.body, { key: 'z', metaKey: true, shiftKey: true, cancelable: true })).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, cancelable: true })).toBe(false)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'))
    const restored = JSON.parse(screen.getByTestId('project').textContent!)
    expect(restored.annotations[0].note.blocks[0].data.text).toBe('A place to start listening.')
    expect(restored.pendingAnnotationIds).toEqual(['fixture-one', 'fixture-two'])
    fireEvent.click(screen.getByRole('button', { name: 'Delete fixture' }))
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))
    expect(fireEvent.keyDown(document.body, { key: 'z', metaKey: true, cancelable: true })).toBe(false)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'))
    expect(native.seek).not.toHaveBeenCalled()
  })
  it('surfaces an editor serialization failure in the save status', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Open nonpersistent preview/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Simulate editor error' }))
    expect(screen.getByRole('status').textContent).toContain('Save failed · note not serialized: serialization failed')
  })
})

describe('native project entry', () => {
  it('creates a real project from audio, retaining Unicode and stripping only the final extension', async () => {
    native.enabled = true
    native.chooseAudio.mockResolvedValue('/original/Été mix.v2.flac')
    native.create.mockResolvedValue({ directory: '/notes/demo', recordingUrl: 'asset://recording', project: { version: 1, id: 'native', name: 'demo', recording: { relativePath: 'recording.wav' }, annotations: [], projectNote: { blocks: [] }, pendingAnnotationIds: [] } })
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'New project' })[0]).not.toHaveProperty('disabled', true))
    fireEvent.click(screen.getAllByRole('button', { name: 'New project' })[0])
    fireEvent.click(screen.getByRole('button', { name: /Choose audio/ }))
    await screen.findByDisplayValue('Été mix.v2')
    fireEvent.click(screen.getByRole('button', { name: /Choose location/ }))
    await screen.findByText('/notes')
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(native.create).toHaveBeenCalledWith({ sourceAudioPath: '/original/Été mix.v2.flac', parentDirectory: '/notes', name: 'Été mix.v2' }))
    expect(await screen.findByText('Listening notebook')).toBeTruthy()
    expect(screen.queryByText(/Fixture preview only/)).toBeNull()
  })
  it.each([
    ['/original/No extension', 'No extension'],
    ['/original/.hidden', '.hidden'],
    ['C:\\Audio\\Live set.M4A', 'Live set'],
  ])('suggests a project name for %s', async (path, suggested) => {
    native.enabled = true
    native.chooseAudio.mockResolvedValue(path)
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'New project' })[0]).not.toHaveProperty('disabled', true))
    fireEvent.click(screen.getAllByRole('button', { name: 'New project' })[0])
    fireEvent.click(screen.getByRole('button', { name: /Choose audio/ }))
    await screen.findByDisplayValue(suggested)
  })
  it('shows preparation only during creation and blocks transitions and native close until it finishes', async () => {
    native.enabled = true
    const picker = deferred<string | null>()
    const importing = deferred<never>()
    native.chooseAudio.mockReturnValueOnce(picker.promise)
    native.create.mockReturnValueOnce(importing.promise)
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'New project' })[0]).not.toHaveProperty('disabled', true))
    fireEvent.click(screen.getAllByRole('button', { name: 'New project' })[0])
    fireEvent.click(screen.getByRole('button', { name: /Choose audio/ }))
    expect(screen.queryByText('Preparing audio…')).toBeNull()
    await act(async () => picker.resolve('/original/demo.mp3'))
    fireEvent.click(screen.getByRole('button', { name: /Choose location/ }))
    await screen.findByText('/notes')
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(native.create).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status').textContent).toContain('Preparing your project')
    expect(screen.getByRole('button', { name: 'Preparing audio…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Open project' })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('2. Project name')).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Preparing audio…' }))
    expect(native.create).toHaveBeenCalledTimes(1)
    expect(await native.guard.mock.calls[0][0]()).toBe(false)
    await act(async () => importing.reject(new Error('Audio could not be decoded')))
    expect(screen.getByRole('alert').textContent).toContain('Audio could not be decoded')
    expect(screen.getByRole('button', { name: 'Create project' })).not.toHaveProperty('disabled', true)
    expect(screen.queryByText('Preparing audio…')).toBeNull()
  })
  it('does not run transport shortcuts while a project picker is busy', async () => {
    native.enabled = true
    native.open.mockResolvedValueOnce({ directory: '/notes/demo', recordingUrl: 'asset://recording', project: { version: 1, id: 'native', name: 'demo', recording: { relativePath: 'recording.wav' }, annotations: [], projectNote: { blocks: [] }, pendingAnnotationIds: [] } })
    const picker = deferred<string | null>()
    native.chooseAudio.mockReturnValueOnce(picker.promise)
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open project' })).not.toHaveProperty('disabled', true))
    fireEvent.click(screen.getByRole('button', { name: 'Open project' }))
    await screen.findByText('Listening notebook')
    fireEvent.click(screen.getByRole('button', { name: 'Load recording' }))
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    fireEvent.click(screen.getByRole('button', { name: /Choose audio/ }))
    expect(fireEvent.keyDown(document.body, { key: ' ', cancelable: true })).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight', cancelable: true })).toBe(true)
    expect(native.play).not.toHaveBeenCalled()
    expect(native.seek).not.toHaveBeenCalled()
    await act(async () => picker.resolve(null))
  })
  it('blocks native entry while close protection is pending or fails, and enables it only after retry succeeds', async () => {
    native.enabled = true
    const pending = deferred<() => void>()
    const retry = deferred<() => void>()
    native.guard.mockReturnValueOnce(pending.promise).mockReturnValueOnce(retry.promise)
    render(<App />)
    expect(screen.getAllByRole('button', { name: 'New project' })[0]).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Open project' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getAllByRole('button', { name: 'New project' })[0])
    expect(screen.queryByLabelText('Create project')).toBeNull()
    await act(async () => pending.reject(new Error('listener unavailable')))
    expect(screen.getByRole('alert').textContent).toContain('listener unavailable')
    expect(screen.getAllByRole('button', { name: 'New project' })[0]).toHaveProperty('disabled', true)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Retry protection/ }))
    expect(screen.getAllByRole('button', { name: 'New project' })[0]).toHaveProperty('disabled', true)
    await act(async () => retry.resolve(() => {}))
    expect(screen.getAllByRole('button', { name: 'New project' })[0]).not.toHaveProperty('disabled', true)
    fireEvent.click(screen.getAllByRole('button', { name: 'New project' })[0])
    expect(screen.getByLabelText('Create project')).toBeTruthy()
    expect(native.create).not.toHaveBeenCalled()
    expect(native.open).not.toHaveBeenCalled()
  })
  it('disposes a late StrictMode registration without enabling a stale guard', async () => {
    native.enabled = true
    const stale = deferred<() => void>()
    const current = deferred<() => void>()
    const stopStale = vi.fn()
    const stopCurrent = vi.fn()
    native.guard.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise)
    const view = render(<StrictMode><App /></StrictMode>)
    expect(native.guard).toHaveBeenCalledTimes(2)
    await act(async () => stale.resolve(stopStale))
    expect(stopStale).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('button', { name: 'New project' })[0]).toHaveProperty('disabled', true)
    await act(async () => current.resolve(stopCurrent))
    expect(screen.getAllByRole('button', { name: 'New project' })[0]).not.toHaveProperty('disabled', true)
    view.unmount()
    expect(stopCurrent).toHaveBeenCalledTimes(1)
  })
})
