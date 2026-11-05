import type { NoteDocument, NoteTarget } from './project'

/** Revision is scoped to a target and increases for every user edit, including unsaved edits. */
export interface EditorSnapshot {
  target: NoteTarget
  revision: number
  document: NoteDocument
}

export interface EditorAdapter {
  /** Resolve only when the previous target has been flushed and the new editor is ready. */
  open(target: NoteTarget, document: NoteDocument, revision: number): Promise<void>
  /** Capture the latest edit, including pending asynchronous serialization. */
  flush(): Promise<EditorSnapshot>
  /** Snapshots retain their originating target and revision even after a switch. */
  subscribe(listener: (snapshot: EditorSnapshot) => void): () => void
  destroy(): Promise<void>
}
