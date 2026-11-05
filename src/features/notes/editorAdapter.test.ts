// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { EditorSnapshot, NoteDocument } from '../../contracts'
import { createEditorAdapter, type EditorFactory } from './editorAdapter'

const doc = (text: string): NoteDocument => ({ blocks: [{ type: 'paragraph', data: { text } }] })
const text = (document: NoteDocument) => document.blocks[0]?.data.text

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

function fakeFactory() {
  const editors: Array<{ content: NoteDocument; onChange: () => void; destroyed: boolean; delay?: ReturnType<typeof deferred<NoteDocument>> }> = []
  const factory: EditorFactory = ({ document, onChange }) => {
    const editor: typeof editors[number] = { content: document, onChange, destroyed: false }
    editors.push(editor)
    return {
      isReady: Promise.resolve(),
      save: () => editor.delay?.promise ?? Promise.resolve(editor.content),
      destroy: () => { editor.destroyed = true },
      focus: () => true,
    }
  }
  return { factory, editors }
}

describe('Editor.js adapter', () => {
  it('serializes the last keystroke during an in-flight save before switching, without retargeting snapshots', async () => {
    const { factory, editors } = fakeFactory()
    const adapter = createEditorAdapter(document.createElement('div'), { factory })
    const snapshots: EditorSnapshot[] = []
    adapter.subscribe(s => snapshots.push(s))
    const first = { kind: 'annotation', id: 'a' } as const
    const second = { kind: 'annotation', id: 'b' } as const
    await adapter.open(first, doc('initial'), 0)
    const old = editors[0]
    const delayed = deferred<NoteDocument>()
    old.delay = delayed
    old.content = doc('first edit')
    old.onChange()
    // Let the queued save begin before requesting a switch and typing again.
    await Promise.resolve()
    const switching = adapter.open(second, doc('second note'), 0)
    old.content = doc('last keystroke')
    old.onChange()
    old.delay = undefined
    delayed.resolve(doc('first edit'))
    await switching
    expect(old.destroyed).toBe(true)
    const aSnapshots = snapshots.filter(s => s.target.kind === 'annotation' && s.target.id === 'a')
    expect(text(aSnapshots.at(-1)!.document)).toBe('last keystroke')
    expect(aSnapshots.at(-1)!.revision).toBeGreaterThan(aSnapshots[0].revision)
    expect(snapshots.filter(s => s.target.kind === 'annotation' && s.target.id === 'b')).toHaveLength(0)
    editors[1].content = doc('new edit')
    editors[1].onChange()
    const result = await adapter.flush()
    expect(result.target).toEqual(second)
    expect(text(result.document)).toBe('new edit')
    await adapter.open(first, aSnapshots.at(-1)!.document, 0)
    expect((await adapter.flush()).revision).toBeGreaterThanOrEqual(aSnapshots.at(-1)!.revision)
    await adapter.destroy()
  })

  it('keeps the same editor on rerender and detects a not-yet-notified edit on flush', async () => {
    const { factory, editors } = fakeFactory()
    const adapter = createEditorAdapter(document.createElement('div'), { factory })
    const target = { kind: 'project' } as const
    await adapter.open(target, doc('old'), 4)
    editors[0].content = doc('<b>new</b>')
    await adapter.open(target, doc('stale rerender'), 4)
    expect(editors).toHaveLength(1)
    const snapshot = await adapter.flush()
    expect(snapshot.revision).toBe(5)
    expect(text(snapshot.document)).toBe('<b>new</b>')
    await adapter.destroy()
  })

  it('does not destroy or switch away from an editor whose flush fails', async () => {
    let fail = true
    let destroyed = false
    const factory: EditorFactory = () => ({
      isReady: Promise.resolve(),
      save: () => fail ? Promise.reject(new Error('save failed')) : Promise.resolve(doc('retained')),
      destroy: () => { destroyed = true }, focus: () => true,
    })
    const adapter = createEditorAdapter(document.createElement('div'), { factory })
    await adapter.open({ kind: 'project' }, doc('original'), 0)
    await expect(adapter.open({ kind: 'annotation', id: 'b' }, doc(''), 0)).rejects.toThrow('save failed')
    expect(destroyed).toBe(false)
    fail = false
    expect((await adapter.flush()).target).toEqual({ kind: 'project' })
    await adapter.destroy()
  })

  it('focuses the current visible editable when caret focus returns false, but never a stale target', async () => {
    const holder = document.createElement('div')
    const elsewhere = document.createElement('button')
    document.body.append(holder, elsewhere)
    const focus = vi.fn(() => false)
    const factory: EditorFactory = () => {
      holder.innerHTML = '<div class="ce-block__content"><div contenteditable="true">text</div></div>'
      return { isReady: Promise.resolve(), save: async () => doc('text'), focus, destroy: () => { holder.innerHTML = '' } }
    }
    const adapter = createEditorAdapter(holder, { factory })
    const a = { kind: 'annotation', id: 'a' } as const
    const b = { kind: 'annotation', id: 'b' } as const
    await adapter.open(a, doc('text'), 0)
    elsewhere.focus()
    adapter.focus(b)
    expect(focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(elsewhere)
    holder.hidden = true
    adapter.focus(a)
    expect(focus).not.toHaveBeenCalled()
    holder.hidden = false
    adapter.focus(a)
    const editable = holder.querySelector('[contenteditable="true"]')!
    expect(document.activeElement).toBe(editable)
    const selection = document.getSelection()!
    expect(selection.isCollapsed).toBe(true)
    expect(editable.contains(selection.anchorNode)).toBe(true)
    expect(selection.anchorOffset).toBe(editable.childNodes.length)
    await adapter.destroy()
    holder.remove()
    elsewhere.remove()
  })
})
