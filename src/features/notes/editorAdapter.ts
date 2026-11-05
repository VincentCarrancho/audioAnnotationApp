import EditorJS from '@editorjs/editorjs'
import Header from '@editorjs/header'
import List from '@editorjs/list'
import type { EditorAdapter, EditorSnapshot, NoteDocument, NoteTarget } from '../../contracts'

/** The narrow seam also permits exercising asynchronous Editor.js behavior in tests. */
export interface EditorInstance {
  isReady: Promise<void>
  save(): Promise<NoteDocument>
  destroy(): void
  focus(atEnd?: boolean): boolean
}

export type EditorFactory = (options: {
  holder: HTMLElement
  document: NoteDocument
  onChange: () => void
}) => EditorInstance

const editorFactory: EditorFactory = ({ holder, document, onChange }) => new EditorJS({
  holder,
  data: document,
  autofocus: false,
  minHeight: 120,
  placeholder: 'Write a note…',
  inlineToolbar: ['bold', 'italic', 'link'],
  tools: { header: Header, list: List },
  onChange,
})

export function sameTarget(a: NoteTarget | null, b: NoteTarget | null): boolean {
  return a !== null && b !== null && a.kind === b.kind &&
    (a.kind === 'project' || (b.kind === 'annotation' && a.id === b.id))
}

interface Session {
  target: NoteTarget
  editor: EditorInstance
  revision: number
  publishedRevision: number
  fingerprint: string
  onInput: () => void
}

// Ignore Editor.js save metadata when deciding whether a silent edit occurred.
const fingerprint = (document: NoteDocument) => JSON.stringify(document.blocks)
const key = (target: NoteTarget) => target.kind === 'project' ? 'project' : `annotation:${target.id}`

export interface NoteEditorAdapter extends EditorAdapter {
  focus(): void
}

/** Serializes all saves and transitions; errors leave the current editor intact. */
export function createEditorAdapter(
  holder: HTMLElement,
  options: { factory?: EditorFactory; onError?: (error: unknown) => void } = {},
): NoteEditorAdapter {
  const factory = options.factory ?? editorFactory
  const listeners = new Set<(snapshot: EditorSnapshot) => void>()
  const revisions = new Map<string, number>()
  let session: Session | null = null
  let tail: Promise<unknown> = Promise.resolve()
  let destroyed = false

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation)
    // Recover the queue, but never hide an error from the caller.
    tail = result.catch(() => undefined)
    return result
  }

  function publish(snapshot: EditorSnapshot) {
    for (const listener of listeners) listener(snapshot)
  }

  async function saveCurrent(current: Session): Promise<EditorSnapshot> {
    let snapshot: EditorSnapshot
    do {
      const startedRevision = current.revision
      const document = await current.editor.save()
      const nextFingerprint = fingerprint(document)
      // flush also catches changes not yet delivered by Editor.js's batched onChange.
      const silentEdit = nextFingerprint !== current.fingerprint && startedRevision <= current.publishedRevision && current.revision === startedRevision
      if (silentEdit) {
        current.revision = current.publishedRevision + 1
      }
      const revision = silentEdit ? current.revision : Math.max(startedRevision, current.publishedRevision)
      current.fingerprint = nextFingerprint
      current.publishedRevision = revision
      revisions.set(key(current.target), revision)
      snapshot = { target: current.target, revision, document }
      publish(snapshot)
      // Input during save requires another serialization before a switch/flush resolves.
    } while (current.revision > snapshot.revision)
    return snapshot
  }

  function changed(current: Session) {
    if (session !== current || destroyed) return
    current.revision++
    void enqueue(async () => {
      if (session === current) await saveCurrent(current)
    }).catch((error: unknown) => options.onError?.(error))
  }

  return {
    open(target, document, revision) {
      return enqueue(async () => {
        if (destroyed) throw new Error('Editor has been destroyed')
        if (session && sameTarget(session.target, target)) return
        if (session) {
          await saveCurrent(session)
          holder.removeEventListener('input', session.onInput)
          session.editor.destroy()
          session = null
        }
        const initialRevision = Math.max(revision, revisions.get(key(target)) ?? 0)
        let current: Session | null = null
        const editor = factory({ holder, document, onChange: () => { if (current) changed(current) } })
        current = { target: { ...target }, editor, revision: initialRevision,
          publishedRevision: initialRevision, fingerprint: fingerprint(document),
          onInput: () => { if (current) changed(current) } }
        session = current
        holder.addEventListener('input', current.onInput)
        try {
          await editor.isReady
        } catch (error) {
          holder.removeEventListener('input', current.onInput)
          // Not all Editor.js methods exist if initialization fails.
          try { editor.destroy() } catch { /* initialization failed */ }
          session = null
          throw error
        }
      })
    },
    flush() {
      return enqueue(async () => {
        if (!session) throw new Error('No note is open')
        return saveCurrent(session)
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    destroy() {
      return enqueue(async () => {
        if (destroyed) return
        if (session) {
          await saveCurrent(session)
          holder.removeEventListener('input', session.onInput)
          session.editor.destroy()
          session = null
        }
        destroyed = true
        listeners.clear()
      })
    },
    focus() { session?.editor.focus(true) },
  }
}
