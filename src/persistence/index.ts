import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import type { ProjectData, ProjectRepository, ProjectSession, SaveStatus } from '../contracts'

interface NativeOpened {
  directory: string
  project: ProjectData
  recordingPath: string
  token: string
}

type Writer = (session: ProjectSession, project: ProjectData, revision: number) => Promise<void>
type Waiter = { revision: number; resolve: () => void; reject: (error: Error) => void }
type Snapshot = { revision: number; json: string; project: ProjectData }
type Queue = { latest?: Snapshot; durable?: Snapshot; running: boolean; waiters: Waiter[] }

const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error))

/** Per-session full-snapshot queue. Equal revisions must describe the same snapshot. */
export class RevisionWriter {
  private readonly queues = new WeakMap<ProjectSession, Queue>()
  constructor(private readonly write: Writer) {}

  save(session: ProjectSession, project: ProjectData, revision: number): Promise<void> {
    if (!Number.isSafeInteger(revision) || revision < 0) return Promise.reject(new Error('Save revision must be a non-negative safe integer'))
    let snapshot: Snapshot
    try {
      const json = JSON.stringify(project)
      snapshot = { revision, json, project: JSON.parse(json) as ProjectData }
    } catch (error) { return Promise.reject(asError(error)) }
    const queue = this.queues.get(session) ?? { running: false, waiters: [] }
    this.queues.set(session, queue)
    const newest = queue.latest ?? queue.durable
    if (newest && revision === newest.revision && snapshot.json !== newest.json) return Promise.reject(new Error('A save revision was reused for different content'))
    if (queue.durable && revision === queue.durable.revision && snapshot.json !== queue.durable.json) return Promise.reject(new Error('A save revision was reused for different content'))
    if (queue.durable && revision <= queue.durable.revision) return Promise.resolve()
    if (!queue.latest || revision > queue.latest.revision) queue.latest = snapshot
    return new Promise((resolve, reject) => {
      queue.waiters.push({ revision, resolve, reject })
      if (!queue.running) {
        queue.running = true
        void this.drain(session, queue)
      }
    })
  }

  private async drain(session: ProjectSession, queue: Queue): Promise<void> {
    while (queue.latest) {
      const snapshot = queue.latest
      try {
        await this.write(session, snapshot.project, snapshot.revision)
      } catch (error) {
        // Leave the latest snapshot available for a later explicit retry.
        const waiters = queue.waiters.splice(0)
        queue.running = false
        waiters.forEach(waiter => waiter.reject(asError(error)))
        return
      }
      queue.durable = snapshot
      const completed = queue.waiters.filter(waiter => waiter.revision <= snapshot.revision)
      queue.waiters = queue.waiters.filter(waiter => waiter.revision > snapshot.revision)
      completed.forEach(waiter => waiter.resolve())
      if (queue.latest === snapshot) queue.latest = undefined
    }
    queue.running = false
  }
}

/** Native repository. Each open invalidates any older native session for the same folder. */
export class NativeProjectRepository implements ProjectRepository {
  private readonly tokens = new WeakMap<ProjectSession, string>()
  private readonly writer = new RevisionWriter(async (session, project, revision) => {
    const token = this.tokens.get(session)
    if (!token) throw new Error('This project session was not opened by this repository')
    await invoke('save_project', { directory: session.directory, token, project, revision })
  })

  private session(opened: NativeOpened): ProjectSession {
    const session: ProjectSession = { directory: opened.directory, project: opened.project, recordingUrl: convertFileSrc(opened.recordingPath) }
    this.tokens.set(session, opened.token)
    return session
  }

  async create(input: { sourceWavPath: string; parentDirectory: string; name: string }): Promise<ProjectSession> {
    return this.session(await invoke<NativeOpened>('create_project', input))
  }

  async open(directory: string): Promise<ProjectSession> {
    return this.session(await invoke<NativeOpened>('open_project', { directory }))
  }

  save(session: ProjectSession, project: ProjectData, revision: number): Promise<void> {
    return this.writer.save(session, project, revision)
  }
}

/** Null means the user canceled the picker. */
export async function chooseSourceWav(): Promise<string | null> {
  return open({ multiple: false, directory: false, filters: [{ name: 'WAV recording', extensions: ['wav'] }] })
}

export async function chooseProjectParent(): Promise<string | null> {
  return open({ multiple: false, directory: true, title: 'Choose a location for the project folder' })
}

export async function chooseProjectFolder(): Promise<string | null> {
  return open({ multiple: false, directory: true, title: 'Open a project folder' })
}

/** Call update with immutable current state after every edit, including completed editor flushes. */
export class SaveCoordinator {
  private revision = 0
  private savedRevision = 0
  private project: ProjectData
  private snapshotJson: string
  private active?: Promise<void>
  status: SaveStatus = { state: 'saved', revision: 0 }

  constructor(private readonly repository: ProjectRepository, private readonly session: ProjectSession, private readonly onChange: (status: SaveStatus, dirty: boolean) => void = () => {}) {
    this.snapshotJson = JSON.stringify(session.project)
    this.project = JSON.parse(this.snapshotJson) as ProjectData
  }

  get dirty(): boolean { return this.revision > this.savedRevision }

  update(project: ProjectData): void {
    const json = JSON.stringify(project)
    if (json === this.snapshotJson) return
    this.snapshotJson = json
    this.project = JSON.parse(json) as ProjectData
    this.revision++
    this.onChange(this.status, this.dirty)
  }

  /** Call only after flushing the editor and applying its snapshot via update(). */
  saveLatest(): Promise<void> {
    if (this.active) return this.active.then(() => this.dirty ? this.saveLatest() : undefined)
    const operation = this.drain()
    this.active = operation.finally(() => { this.active = undefined })
    return this.active
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      const revision = this.revision
      const project = this.project
      this.status = { state: 'saving', revision }
      this.onChange(this.status, this.dirty)
      try {
        await this.repository.save(this.session, project, revision)
      } catch (error) {
        this.status = { state: 'failed', revision, message: asError(error).message }
        this.onChange(this.status, this.dirty)
        throw asError(error)
      }
      this.savedRevision = revision
    }
    this.status = { state: 'saved', revision: this.savedRevision }
    this.onChange(this.status, this.dirty)
  }
}

/**
 * Prevent native closing immediately, then let integration flush the editor and
 * save or ask the user whether to discard. Return true only when closing is safe.
 * Use the same callback before switching projects. Returns an unlisten function.
 */
export async function protectNativeClose(allowClose: () => Promise<boolean>, onError: (error: Error) => void): Promise<() => void> {
  const window = getCurrentWindow()
  let checking = false
  return window.onCloseRequested(event => {
    event.preventDefault()
    if (checking) return
    checking = true
    void (async () => {
      try {
        if (await allowClose()) await window.destroy()
      } catch (error) { onError(asError(error)) }
      finally { checking = false }
    })()
  })
}
