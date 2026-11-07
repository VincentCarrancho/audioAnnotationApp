import type { ProjectData } from './project'

/** Opaque absolute project directory; do not persist this inside ProjectData. */
export interface ProjectSession {
  directory: string
  project: ProjectData
  /** Webview-loadable URL for the project copy, not the original source file. */
  recordingUrl: string
}

export type SaveStatus =
  | { state: 'saved'; revision: number }
  | { state: 'saving'; revision: number }
  | { state: 'failed'; revision: number; message: string }

export interface ProjectRepository {
  /** Preserve the original and prepare a playback copy before returning. */
  create(input: { sourceAudioPath: string; parentDirectory: string; name: string }): Promise<ProjectSession>
  open(directory: string): Promise<ProjectSession>
  /** Serialize writes per project; never let an older revision replace a newer revision. */
  save(session: ProjectSession, project: ProjectData, revision: number): Promise<void>
}
