// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DomainState } from '../../contracts'
import { NotePanel } from './NotePanel'

afterEach(cleanup)

Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation((query: string) => ({
  matches: false, media: query, onchange: null, addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
})) })
// jsdom does not implement the browser's reflected contentEditable property.
Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
  configurable: true,
  get() { return this.getAttribute('contenteditable') ?? 'inherit' },
  set(value: string) { this.setAttribute('contenteditable', value) },
})
Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
  configurable: true,
  get() { return this.getAttribute('contenteditable') === 'true' },
})
// Editor.js uses range geometry for its caret; jsdom has no layout engine.
Range.prototype.getBoundingClientRect = () => new DOMRect()
Range.prototype.getClientRects = () => Object.assign([], { item: () => null })

it('focuses the real editable when opening an empty annotation for review', async () => {
  const state: DomainState = {
    project: { version: 1, id: 'p', name: 'P', recording: { relativePath: 'a.wav' }, projectNote: { blocks: [] },
      annotations: [{ id: 'a', anchor: { kind: 'point', time: 1 }, note: { blocks: [] } }], pendingAnnotationIds: ['a'] },
    selectedNote: { kind: 'annotation', id: 'a' },
    review: { status: 'active', currentId: 'a', skippedIds: [], resumePosition: 1 }, undoDelete: null,
  }
  render(<NotePanel state={state} revision={0} focusRequest={1} onSnapshot={() => {}} onAction={() => {}}
    onPlayAnnotation={() => {}} onLoopAnnotation={() => {}} />)
  await waitFor(() => {
    const holder = screen.getByRole('group', { name: 'Note editor' })
    const editable = holder.querySelector('[contenteditable="true"]')
    expect(editable).not.toBeNull()
    expect(document.activeElement).toBe(editable)
  })
})

it('keeps focus on the transport during passive capture, then focuses the explicitly opened new annotation', async () => {
  const state: DomainState = {
    project: { version: 1, id: 'p', name: 'P', recording: { relativePath: 'a.wav' }, projectNote: { blocks: [] },
      annotations: [{ id: 'a', anchor: { kind: 'point', time: 1 }, note: { blocks: [] } }], pendingAnnotationIds: ['a'] },
    selectedNote: { kind: 'annotation', id: 'a' }, review: { status: 'inactive' }, undoDelete: null,
  }
  const props = { state, revision: 0, onSnapshot: () => {}, onAction: () => {}, onPlayAnnotation: () => {}, onLoopAnnotation: () => {} }
  const view = render(<><button>Transport</button><NotePanel {...props} /></>)
  const transport = screen.getByRole('button', { name: 'Transport' })
  const paragraph = await waitFor(() => {
    const editable = screen.getByRole('group', { name: 'Note editor' }).querySelector('.ce-paragraph')
    expect(editable).not.toBeNull()
    return editable
  })
  transport.focus()
  const captured: DomainState = { ...state, project: { ...state.project, annotations: [
    ...state.project.annotations, { id: 'b', anchor: { kind: 'point', time: 2 }, note: { blocks: [] } },
  ], pendingAnnotationIds: ['a', 'b'] } }
  view.rerender(<><button>Transport</button><NotePanel {...props} state={captured} /></>)
  expect(document.activeElement).toBe(transport)
  expect(screen.getByRole('group', { name: 'Note editor' }).querySelector('.ce-paragraph')).toBe(paragraph)
  const selected: DomainState = { ...captured, selectedNote: { kind: 'annotation', id: 'b' } }
  view.rerender(<><button>Transport</button><NotePanel {...props} state={selected} focusRequest={1} /></>)
  await waitFor(() => {
    const editable = screen.getByRole('group', { name: 'Note editor' }).querySelector('.ce-paragraph')
    expect(editable).not.toBe(paragraph)
    expect(document.activeElement).toBe(editable)
  })
})
