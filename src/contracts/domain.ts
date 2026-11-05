import type { Annotation, AnnotationAnchor, AnnotationId, NoteDocument, ProjectData, Seconds } from './project'

/** Transient state: never restore an active pass or auto-seek on project open. */
export type ReviewPass =
  /** After resuming with skipped items, wait for a new capture or explicit review. */
  | { status: 'inactive'; deferPendingUntilCapture?: true }
  | { status: 'active'; currentId: AnnotationId; skippedIds: AnnotationId[]; resumePosition: Seconds }
  | { status: 'finished'; resumePosition: Seconds }

export interface DomainState {
  project: ProjectData
  review: ReviewPass
  selectedNote: { kind: 'project' } | { kind: 'annotation'; id: AnnotationId } | null
  /** Implementation-owned snapshot sufficient to restore content, ordering and queue state. */
  undoDelete: DeletedAnnotation | null
}

export interface DeletedAnnotation {
  annotation: Annotation
  annotationIndex: number
  pendingIndex: number | null
}

/** IDs and current transport state are provided by the caller; transitions are pure. */
export type DomainAction =
  | { type: 'capture-point'; id: AnnotationId; time: Seconds; duration: Seconds; playing: boolean }
  | { type: 'annotate-selection'; id: AnnotationId; start: Seconds; end: Seconds; position: Seconds; duration: Seconds; playing: boolean }
  | { type: 'user-paused'; position: Seconds }
  | { type: 'playback-ended'; position: Seconds }
  | { type: 'select-note'; id: AnnotationId }
  | { type: 'select-project-note' }
  | { type: 'select-queue-item'; id: AnnotationId; position: Seconds }
  | { type: 'review-pending'; position: Seconds }
  | { type: 'done-next' }
  | { type: 'skip' }
  | { type: 'delete-annotation'; id: AnnotationId }
  | { type: 'undo-delete' }
  | { type: 'resume-listening' }
  | { type: 'update-anchor'; id: AnnotationId; anchor: AnnotationAnchor; duration: Seconds }
  | { type: 'update-note'; target: { kind: 'project' } | { kind: 'annotation'; id: AnnotationId }; note: NoteDocument }

/** Effects are instructions to the composition layer, not side effects performed by the reducer. */
export type DomainEffect =
  | { type: 'seek'; time: Seconds }
  | { type: 'open-note'; id: AnnotationId }
  | { type: 'open-project-note' }
  | { type: 'offer-review-result'; pendingCount: number; resumePosition: Seconds }

export interface DomainTransition {
  state: DomainState
  effects: DomainEffect[]
}

export type DomainReducer = (state: DomainState, action: DomainAction) => DomainTransition
