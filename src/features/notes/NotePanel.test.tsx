// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DomainState } from '../../contracts'

const editor = vi.hoisted(() => ({
  open: vi.fn().mockResolvedValue(undefined),
  flush: vi.fn().mockResolvedValue({ target: { kind: 'project' }, revision: 0, document: { blocks: [] } }),
  focus: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  destroy: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./editorAdapter', () => ({ createEditorAdapter: () => editor }))
import { NotePanel } from './NotePanel'

afterEach(cleanup)
beforeEach(() => { editor.open.mockClear(); editor.flush.mockClear(); editor.focus.mockReset() })

function state(): DomainState {
  return {
    project: { version: 1, id: 'p', name: 'P', recording: { relativePath: 'a.wav' }, projectNote: { blocks: [] },
      annotations: [
        { id: 'late', anchor: { kind: 'point', time: 90 }, note: { blocks: [] } },
        { id: 'early', anchor: { kind: 'range', start: 10, end: 20 }, note: { blocks: [{ type: 'paragraph', data: { text: '<b>First</b>' } }] } },
      ], pendingAnnotationIds: ['late'] },
    selectedNote: { kind: 'annotation', id: 'early' }, review: { status: 'inactive' }, undoDelete: null,
  }
}

describe('note panel', () => {
  it('focuses an explicitly opened annotation only after its editor is visible', async () => {
    const visibilityAtFocus: boolean[] = []
    editor.focus.mockImplementation(() => {
      const holder = document.querySelector<HTMLElement>('.wn-editor')!
      visibilityAtFocus.push(!holder.hidden && getComputedStyle(holder).display !== 'none')
    })
    const props = { state: state(), revision: 0, focusRequest: 1, onSnapshot: vi.fn(), onAction: vi.fn(), onPlayAnnotation: vi.fn(), onLoopAnnotation: vi.fn() }
    render(<NotePanel {...props} />)
    await waitFor(() => expect(visibilityAtFocus).toHaveLength(1))
    expect(visibilityAtFocus).toEqual([true])
  })

  it('shows chronological navigation, explicit play/loop, and does not focus on passive selection or rerender', async () => {
    const props = { state: state(), revision: 0, onSnapshot: vi.fn(), onAction: vi.fn(), onPlayAnnotation: vi.fn(), onLoopAnnotation: vi.fn() }
    const view = render(<NotePanel {...props} />)
    await waitFor(() => expect(editor.open).toHaveBeenCalledTimes(1))
    const nav = screen.getByRole('navigation', { name: 'Annotation navigation' })
    expect(nav.textContent!.indexOf('First')).toBeLessThan(nav.textContent!.indexOf('Pending annotation'))
    fireEvent.click(screen.getByRole('button', { name: 'Play from annotation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Loop annotation' }))
    expect(props.onPlayAnnotation).toHaveBeenCalledWith('early')
    expect(props.onLoopAnnotation).toHaveBeenCalledWith('early')
    view.rerender(<NotePanel {...props} revision={1} />)
    expect(editor.open).toHaveBeenCalledTimes(1)
    expect(editor.focus).not.toHaveBeenCalled()
    view.rerender(<NotePanel {...props} focusRequest={1} />)
    await waitFor(() => expect(editor.focus).toHaveBeenCalledTimes(1))
    view.rerender(<NotePanel {...props} state={{ ...props.state, selectedNote: { kind: 'annotation', id: 'late' } }} focusRequest={1} />)
    await waitFor(() => expect(editor.open).toHaveBeenCalledTimes(3))
    expect(editor.focus).toHaveBeenCalledTimes(1)
  })

  it('surfaces flush errors and does not dispatch the requested navigation', async () => {
    const props = { state: state(), revision: 0, onSnapshot: vi.fn(), onAction: vi.fn(), onPlayAnnotation: vi.fn(), onLoopAnnotation: vi.fn() }
    render(<NotePanel {...props} />)
    await waitFor(() => expect(editor.open).toHaveBeenCalled())
    editor.flush.mockRejectedValueOnce(new Error('broken save'))
    fireEvent.click(screen.getByRole('button', { name: 'Project note' }))
    expect((await screen.findByRole('alert')).textContent).toContain('broken save')
    expect(props.onAction).not.toHaveBeenCalled()
  })

  it('does not transfer an interrupted focus request to a different target', async () => {
    let resolve!: () => void
    editor.open.mockImplementationOnce(() => new Promise<void>(r => { resolve = r }))
    const props = { state: state(), revision: 0, focusRequest: 9, onSnapshot: vi.fn(), onAction: vi.fn(), onPlayAnnotation: vi.fn(), onLoopAnnotation: vi.fn() }
    const view = render(<NotePanel {...props} />)
    await waitFor(() => expect(editor.open).toHaveBeenCalledTimes(1))
    view.rerender(<NotePanel {...props} state={{ ...props.state, selectedNote: { kind: 'annotation', id: 'late' } }} />)
    await waitFor(() => expect(editor.open).toHaveBeenCalledTimes(2))
    resolve()
    await Promise.resolve()
    expect(editor.focus).not.toHaveBeenCalled()
  })

  it('focuses explicit same-target requests and ignores a stale rapid switch', async () => {
    const focusedHeadings: string[] = []
    const visible: boolean[] = []
    editor.focus.mockImplementation(() => {
      const holder = document.querySelector<HTMLElement>('.wn-editor')!
      visible.push(!holder.hidden && getComputedStyle(holder).display !== 'none')
      focusedHeadings.push(document.querySelector('.wn-note-heading h2')!.textContent!)
    })
    const props = { state: state(), revision: 0, focusRequest: 1, onSnapshot: vi.fn(), onAction: vi.fn(), onPlayAnnotation: vi.fn(), onLoopAnnotation: vi.fn() }
    const view = render(<NotePanel {...props} />)
    await waitFor(() => expect(focusedHeadings).toHaveLength(1))
    view.rerender(<NotePanel {...props} focusRequest={2} />)
    await waitFor(() => expect(focusedHeadings).toHaveLength(2))
    view.rerender(<NotePanel {...props} focusRequest={2} revision={3} />)
    expect(focusedHeadings).toHaveLength(2)

    let resolveLate!: () => void
    editor.open.mockImplementationOnce(() => new Promise<void>(resolve => { resolveLate = resolve }))
    view.rerender(<NotePanel {...props} focusRequest={3} state={{ ...props.state, selectedNote: { kind: 'annotation', id: 'late' } }} />)
    await waitFor(() => expect(editor.open).toHaveBeenCalledTimes(3))
    view.rerender(<NotePanel {...props} focusRequest={4} />)
    await waitFor(() => expect(focusedHeadings).toHaveLength(3))
    resolveLate()
    await Promise.resolve()
    expect(focusedHeadings).toEqual(['Annotation · 0:10 – 0:20', 'Annotation · 0:10 – 0:20', 'Annotation · 0:10 – 0:20'])
    expect(visible).toEqual([true, true, true])
  })
})
